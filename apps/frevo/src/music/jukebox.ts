// The jury's music on the world server. Marking a bloco prepares its music in
// the background; the host plays it (and plays it again) on the telão, which
// gets the command through its stream and reports back whether its sound is
// on. Music that fails, is late or is not ready yet becomes the embedded
// track, so the end of the dynamic never waits for a music service.
import {
  EMBEDDED_TRACK,
  embeddedMusic,
  FREVO_STYLE,
  type MusicGenerator,
} from "./generator";

export interface TrackStatus {
  /** Why it fell back to the embedded track, for the admin; null otherwise. */
  reason: string | null;
  /** "reserva": the generator failed or was late; the embedded track plays. */
  state: "gerando" | "pronta" | "reserva";
  /** Null while it is being made. */
  url: string | null;
}

/** What the telão plays now; a command with no url stops the sound. */
export interface PlayCommand {
  /** Server time of the command, so a telão that connects later skips old ones. */
  atMs: number;
  blocoId: string | null;
  /** What the telão plays when `url` does not load. */
  fallbackUrl: string;
  /** Grows with every command, so playing again is a new command. */
  id: number;
  url: string | null;
}

export interface SoundStatus {
  /** A telão turned its sound on and keeps reporting. */
  enabled: boolean;
  /** The bloco a telão reports playing now. */
  playing: string | null;
}

export interface BlocoMusic {
  blocoId: string;
  blocoName: string;
  refrain: string[];
}

export interface Jukebox {
  current: () => PlayCommand | null;
  play: (bloco: BlocoMusic) => PlayCommand;
  /** Starts making the bloco's music, once. */
  prepare: (bloco: BlocoMusic) => void;
  /** A telão says whether its sound is on and what it plays. */
  report: (
    telaoId: string,
    input: { enabled: boolean; playing: string | null }
  ) => void;
  /** Forgets everything, for when the dynamic restarts. */
  reset: () => void;
  sound: () => SoundStatus;
  stop: () => PlayCommand;
  tracks: () => Record<string, TrackStatus>;
}

export interface JukeboxOptions {
  fallbackUrl?: string;
  generator?: MusicGenerator;
  log?: (line: string) => void;
  now?: () => number;
  /** Music not ready after this long becomes the embedded track. */
  timeoutMs?: number;
}

/** A telão that has not reported for this long no longer counts. */
const REPORT_STALE_MS = 12_000;

export function createJukebox(options: JukeboxOptions = {}): Jukebox {
  const generator = options.generator ?? embeddedMusic;
  const fallbackUrl = options.fallbackUrl ?? EMBEDDED_TRACK;
  const timeoutMs = options.timeoutMs ?? 105_000;
  const now = options.now ?? Date.now;
  const log = options.log ?? (() => undefined);

  let tracks = new Map<string, TrackStatus>();
  let command: PlayCommand | null = null;
  let commands = 0;
  /** Grows on reset, so answers from before it are dropped. */
  let epoch = 0;
  const reports = new Map<
    string,
    { atMs: number; enabled: boolean; playing: string | null }
  >();

  function settle(blocoId: string, from: number, status: TrackStatus) {
    if (from === epoch && tracks.get(blocoId)?.state === "gerando") {
      tracks.set(blocoId, status);
    }
  }

  function prepare(bloco: BlocoMusic) {
    if (tracks.has(bloco.blocoId)) {
      return;
    }
    const from = epoch;
    tracks.set(bloco.blocoId, { state: "gerando", url: null, reason: null });
    const timer = setTimeout(() => {
      log(`Music for ${bloco.blocoId} is late: the embedded track plays`);
      settle(bloco.blocoId, from, {
        state: "reserva",
        url: fallbackUrl,
        reason: `passou de ${Math.round(timeoutMs / 1000)} s`,
      });
    }, timeoutMs);
    let made: Promise<{ url: string }>;
    try {
      made = generator({
        blocoName: bloco.blocoName,
        refrain: bloco.refrain,
        style: FREVO_STYLE,
      });
    } catch (error) {
      made = Promise.reject(error);
    }
    made
      .then(({ url }) =>
        settle(bloco.blocoId, from, { state: "pronta", url, reason: null })
      )
      .catch((error: unknown) => {
        const reason =
          error instanceof Error ? error.message : "erro desconhecido";
        log(
          `Music for ${bloco.blocoId} failed (${reason}): the embedded track plays`
        );
        settle(bloco.blocoId, from, {
          state: "reserva",
          url: fallbackUrl,
          reason,
        });
      })
      .finally(() => clearTimeout(timer));
  }

  function issue(blocoId: string | null, url: string | null): PlayCommand {
    commands += 1;
    command = { id: commands, atMs: now(), blocoId, url, fallbackUrl };
    return command;
  }

  return {
    prepare,
    play(bloco) {
      prepare(bloco);
      return issue(
        bloco.blocoId,
        tracks.get(bloco.blocoId)?.url ?? fallbackUrl
      );
    },
    stop: () => issue(null, null),
    current: () => command,
    tracks: () => Object.fromEntries(tracks),
    report(telaoId, input) {
      reports.set(telaoId, { ...input, atMs: now() });
    },
    sound() {
      const fresh = [...reports.values()]
        .filter((report) => now() - report.atMs < REPORT_STALE_MS)
        .filter((report) => report.enabled)
        .sort((a, b) => b.atMs - a.atMs);
      return {
        enabled: fresh.length > 0,
        playing: fresh.find((report) => report.playing)?.playing ?? null,
      };
    },
    reset() {
      epoch += 1;
      tracks = new Map();
      command = null;
    },
  };
}
