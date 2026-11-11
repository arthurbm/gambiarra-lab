// The Room's `llm.complete` and `llm.error` events from the management plane.
// The hub's stream is per Room code and Bun closes it after about ten quiet
// seconds, so this keeps reconnecting, to whatever code the Room has now.
// Events sent while it reconnects are lost; `onOpen` says when that may have
// happened, so the metrics can stop waiting for them.
import type { HubLlmEvent } from "../brains/metrics";

const TRAILING_SLASH = /\/$/;
/** How often the Room code is checked while a stream is open. */
const CODE_CHECK_MS = 1000;

export interface RoomEventsWatch {
  stop: () => Promise<void>;
}

export interface RoomEventsOptions {
  hubUrl: string;
  onEvent: (event: HubLlmEvent) => void;
  /** A stream (re)opened; events sent before it may be lost. */
  onOpen?: () => void;
  /** Pause before connecting again. */
  retryMs?: number;
  roomCode: () => string | null;
}

function toEvent(data: string): HubLlmEvent | undefined {
  let parsed: {
    data?: { metrics?: HubLlmEvent["metrics"]; participantId?: unknown };
    type?: unknown;
  };
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }
  const participantId = parsed.data?.participantId;
  if (
    (parsed.type === "llm.complete" || parsed.type === "llm.error") &&
    typeof participantId === "string"
  ) {
    return {
      type: parsed.type,
      participantId,
      metrics: parsed.data?.metrics,
    };
  }
}

export function watchRoomLlmEvents(
  options: RoomEventsOptions
): RoomEventsWatch {
  const retryMs = options.retryMs ?? 500;
  let stopped = false;
  let current: AbortController | undefined;

  async function readOnce(code: string) {
    const abort = new AbortController();
    current = abort;
    const follow = setInterval(() => {
      if (stopped || options.roomCode() !== code) {
        abort.abort();
      }
    }, CODE_CHECK_MS);
    try {
      const response = await fetch(
        `${options.hubUrl.replace(TRAILING_SLASH, "")}/v1/rooms/${encodeURIComponent(code)}/events`,
        { headers: { Accept: "text/event-stream" }, signal: abort.signal }
      );
      if (!(response.ok && response.body)) {
        return;
      }
      options.onOpen?.();
      const reader = response.body
        .pipeThrough(new TextDecoderStream())
        .getReader();
      let pending = "";
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: the stream is read one chunk at a time.
        const { done, value } = await reader.read();
        if (done) {
          return;
        }
        pending += value;
        const blocks = pending.split("\n\n");
        pending = blocks.pop() ?? "";
        for (const block of blocks) {
          const data = block
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n");
          const event = data ? toEvent(data) : undefined;
          if (event) {
            options.onEvent(event);
          }
        }
      }
    } catch {
      // Dropped or aborted; the loop connects again.
    } finally {
      clearInterval(follow);
    }
  }

  const loop = (async () => {
    while (!stopped) {
      const code = options.roomCode();
      if (code) {
        // biome-ignore lint/performance/noAwaitInLoops: one stream at a time.
        await readOnce(code);
      }
      if (!stopped) {
        await Bun.sleep(retryMs);
      }
    }
  })();

  return {
    async stop() {
      stopped = true;
      current?.abort();
      await loop;
    },
  };
}
