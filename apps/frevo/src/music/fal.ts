// The music of a chosen bloco made on fal.ai, through its queue with plain
// fetch: MiniMax first (it sang the exact refrain in the tests), ElevenLabs if
// MiniMax fails or is late, and an error the jukebox turns into the embedded
// track if both do. Every audio is downloaded and served by the world. The
// key comes from the caller (the environment) and goes only into the
// Authorization header: never into a log, an error or a URL.

import type { MusicFile, MusicFiles } from "./files";
import type { MusicGenerator } from "./generator";

export const MINIMAX = "fal-ai/minimax-music/v2.6";
export const ELEVENLABS = "fal-ai/elevenlabs/music";
const QUEUE_URL = "https://queue.fal.run";
/** A 30 s MP3 at 128 kbps is about half a megabyte. */
const MAX_AUDIO_BYTES = 20 * 1024 * 1024;
/** No single call waits longer than this, even with time left in the step. */
const CALL_TIMEOUT_MS = 10_000;
/** Time for the download and the jukebox's own margin, after both steps. */
const DEADLINE_SLACK_MS = 15_000;

export const DEFAULT_MAX_GENERATIONS = 6;
/** Measured: MiniMax 34 to 48 s, ElevenLabs 9 to 12 s (see the ticket #20). */
export const DEFAULT_TIMEOUTS_MS = { minimax: 75_000, elevenlabs: 30_000 };

interface Step {
  endpoint: string;
  input: (refrain: string[], style: string) => Record<string, unknown>;
  label: string;
  timeoutMs: number;
}

/** MiniMax has no duration: it follows the lyrics, so a short refrain is sung twice. */
function minimaxLyrics(refrain: string[]): string {
  const chorus = ["[Chorus]", ...refrain];
  const times = refrain.length < 4 ? 2 : 1;
  return [
    "[Intro]",
    ...Array.from({ length: times }, () => chorus).flat(),
    "[Outro]",
  ].join("\n");
}

function steps(timeouts: { elevenlabs: number; minimax: number }): Step[] {
  return [
    {
      endpoint: MINIMAX,
      label: "MiniMax",
      timeoutMs: timeouts.minimax,
      input: (refrain, style) => ({
        prompt: `${style} Joyful mixed choir singing the chorus in Brazilian Portuguese. Short song, about 30 seconds.`,
        lyrics: minimaxLyrics(refrain),
        audio_setting: { sample_rate: 44_100, bitrate: 128_000, format: "mp3" },
      }),
    },
    {
      endpoint: ELEVENLABS,
      label: "ElevenLabs",
      timeoutMs: timeouts.elevenlabs,
      input: (refrain, style) => ({
        prompt: `${style} After a short brass intro, a joyful mixed choir sings this chorus in Brazilian Portuguese, exactly as written:\n\n${refrain.join("\n")}`,
        music_length_ms: 30_000,
        force_instrumental: false,
        output_format: "mp3_44100_128",
      }),
    },
  ];
}

export interface FalMusicOptions {
  /** Where the downloaded copies are kept and served from. */
  files: MusicFiles;
  key: string;
  log?: (line: string) => void;
  /** Generations (fal.ai requests) for the life of the server. */
  maxGenerations?: number;
  pollMs?: number;
  queueUrl?: string;
  timeoutsMs?: Partial<typeof DEFAULT_TIMEOUTS_MS>;
}

export interface FalMusic {
  /** How long the jukebox should wait before giving up on a bloco's music. */
  deadlineMs: number;
  generate: MusicGenerator;
  /** Null when music generation is off (no key). */
  generations: () => { max: number; used: number } | null;
}

/** A failure whose message is safe for the admin's screen and the log. */
class StepFailure extends Error {
  /** fal.ai refused the request, so nothing was made and nothing was spent. */
  readonly refused: boolean;
  constructor(message: string, refused = false) {
    super(message);
    this.refused = refused;
  }
}

function audioUrlOf(body: unknown): string | null {
  const url = (body as { audio?: { url?: unknown } } | null)?.audio?.url;
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : null;
}

export function createFalMusic(options: FalMusicOptions): FalMusic {
  const queueUrl = options.queueUrl ?? QUEUE_URL;
  const pollMs = options.pollMs ?? 1500;
  const max = options.maxGenerations ?? DEFAULT_MAX_GENERATIONS;
  const log = options.log ?? (() => undefined);
  const timeouts = { ...DEFAULT_TIMEOUTS_MS, ...options.timeoutsMs };
  const headers = {
    Authorization: `Key ${options.key}`,
    "Content-Type": "application/json",
  };
  let used = 0;

  async function run(step: Step, refrain: string[], style: string) {
    const deadline = Date.now() + step.timeoutMs;
    const left = () => deadline - Date.now();
    const signal = () =>
      AbortSignal.timeout(Math.max(1, Math.min(CALL_TIMEOUT_MS, left())));
    const late = () =>
      new StepFailure(
        `${step.label} passou de ${Math.round(step.timeoutMs / 1000)} s`
      );
    let cancelUrl: string | null = null;
    try {
      const submit = await fetch(`${queueUrl}/${step.endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify(step.input(refrain, style)),
        signal: signal(),
      });
      if (!submit.ok) {
        throw new StepFailure(
          `${step.label} recusou o pedido (HTTP ${submit.status})`,
          true
        );
      }
      const queued = (await submit.json()) as {
        cancel_url?: string;
        response_url?: string;
        status_url?: string;
      };
      cancelUrl = queued.cancel_url ?? null;
      if (!(queued.status_url && queued.response_url)) {
        throw new StepFailure(`${step.label} respondeu fora do esperado`);
      }
      while (true) {
        // biome-ignore lint/performance/noAwaitInLoops: polling waits by design.
        await Bun.sleep(Math.max(0, Math.min(pollMs, left())));
        if (left() <= 0) {
          throw late();
        }
        const status = await fetch(queued.status_url, {
          headers,
          signal: signal(),
        });
        // A status that does not answer is asked again on the next turn.
        const body = status.ok
          ? ((await status.json()) as { status?: string })
          : null;
        if (body?.status === "COMPLETED") {
          break;
        }
      }
      // A failure also ends as COMPLETED; the error is in the result.
      const result = await fetch(queued.response_url, {
        headers,
        signal: signal(),
      });
      if (!result.ok) {
        throw new StepFailure(`${step.label} falhou (HTTP ${result.status})`);
      }
      const audioUrl = audioUrlOf(await result.json());
      if (!audioUrl) {
        throw new StepFailure(`${step.label} não devolveu áudio`);
      }
      // The audio host needs no key, so it never gets one.
      const audio = await fetch(audioUrl, { signal: signal() });
      if (!audio.ok) {
        throw new StepFailure(
          `${step.label}: o áudio não baixou (HTTP ${audio.status})`
        );
      }
      const bytes = new Uint8Array(await audio.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_AUDIO_BYTES) {
        throw new StepFailure(`${step.label}: áudio de tamanho inválido`);
      }
      const type = audio.headers.get("content-type") ?? "";
      return {
        bytes,
        type: type.startsWith("audio/") ? type : "audio/mpeg",
      } satisfies MusicFile;
    } catch (error) {
      const failure =
        error instanceof StepFailure && left() > 0
          ? error
          : left() <= 0
            ? late()
            : new StepFailure(`${step.label} sem resposta`);
      if (left() <= 0 && cancelUrl) {
        // Best effort, so a late request stops running on fal.ai.
        fetch(cancelUrl, {
          method: "PUT",
          headers,
          signal: AbortSignal.timeout(5000),
        }).catch(() => undefined);
      }
      throw failure;
    }
  }

  const generate: MusicGenerator = async ({ blocoName, refrain, style }) => {
    const reasons: string[] = [];
    for (const step of steps(timeouts)) {
      if (used >= max) {
        reasons.push(`teto de ${max} gerações atingido`);
        break;
      }
      // Counted before the request, so blocos made at the same time never pass the ceiling.
      used += 1;
      const startedAt = Date.now();
      try {
        // biome-ignore lint/performance/noAwaitInLoops: the next generator runs only if this one fails.
        const file = await run(step, refrain, style);
        log(
          `Music for "${blocoName}" made by ${step.endpoint} in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`
        );
        return { url: options.files.put(file) };
      } catch (error) {
        const reason =
          error instanceof StepFailure
            ? error.message
            : `${step.label}: erro inesperado`;
        if (error instanceof StepFailure && error.refused) {
          used -= 1;
        }
        reasons.push(reason);
        log(`Music for "${blocoName}": ${reason}`);
      }
    }
    throw new Error(reasons.join("; "));
  };

  return {
    generate,
    generations: () => ({ used, max }),
    deadlineMs: timeouts.minimax + timeouts.elevenlabs + DEADLINE_SLACK_MS,
  };
}

/** The music the world uses: fal.ai with a key, the embedded track without one. */
export function musicFromKey(
  key: string | undefined,
  options: Omit<FalMusicOptions, "key">
): FalMusic {
  if (key) {
    return createFalMusic({ ...options, key });
  }
  return {
    generate: () =>
      Promise.reject(new Error("sem FAL_KEY: música gerada desligada")),
    generations: () => null,
    deadlineMs: DEADLINE_SLACK_MS,
  };
}
