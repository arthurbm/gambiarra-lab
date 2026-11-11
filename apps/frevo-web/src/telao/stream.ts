// The telão's connection to the world server. The browser's EventSource
// reconnects by itself after a drop, but gives up for good when the server
// answers with an error (a deploy, a restart) and never notices a connection
// that went silent. This wrapper covers both: it opens a new connection when
// the old one is closed or quiet for too long.

export type StreamStatus = "connecting" | "live" | "reconnecting";

/** The part of the browser's EventSource this module uses. */
export interface EventSourceLike {
  addEventListener: (
    type: string,
    listener: (event: { data: string }) => void
  ) => void;
  close: () => void;
  onerror: (() => void) | null;
  /** 0 connecting, 1 open, 2 closed. */
  readonly readyState: number;
}

interface Timers<Handle> {
  clearTimeout: (handle: Handle) => void;
  setTimeout: (run: () => void, ms: number) => Handle;
}

export interface TelaoStreamOptions<Snapshot, Handle = unknown> {
  createEventSource?: (url: string) => EventSourceLike;
  onSnapshot: (snapshot: Snapshot) => void;
  onStatus: (status: StreamStatus) => void;
  /** Wait before opening a new connection. */
  retryMs?: number;
  /** Silence after which the connection is taken for dead. */
  staleMs?: number;
  timers?: Timers<Handle>;
  url: string;
}

const CLOSED = 2;

/** Connects and keeps connected; returns the function that disconnects. */
export function connectTelaoStream<Snapshot, Handle = unknown>(
  options: TelaoStreamOptions<Snapshot, Handle>
): () => void {
  const retryMs = options.retryMs ?? 1000;
  const staleMs = options.staleMs ?? 5000;
  const timers = (options.timers ?? {
    setTimeout: (run: () => void, ms: number) => setTimeout(run, ms),
    clearTimeout: (handle: unknown) =>
      clearTimeout(handle as ReturnType<typeof setTimeout>),
  }) as Timers<Handle>;
  const createEventSource =
    options.createEventSource ??
    ((url: string): EventSourceLike => {
      const browser = new EventSource(url);
      const like: EventSourceLike = {
        addEventListener: (type, listener) =>
          browser.addEventListener(type, (event) =>
            listener(event as MessageEvent<string>)
          ),
        close: () => browser.close(),
        onerror: null,
        get readyState() {
          return browser.readyState;
        },
      };
      browser.onerror = () => like.onerror?.();
      return like;
    });

  let source: EventSourceLike | undefined;
  let status: StreamStatus | undefined;
  let stale: Handle | undefined;
  let retry: Handle | undefined;
  let stopped = false;

  function setStatus(next: StreamStatus) {
    if (next !== status) {
      status = next;
      options.onStatus(next);
    }
  }

  function clear(handle: Handle | undefined) {
    if (handle !== undefined) {
      timers.clearTimeout(handle);
    }
  }

  function watchSilence() {
    clear(stale);
    stale = timers.setTimeout(() => {
      setStatus("reconnecting");
      open();
    }, staleMs);
  }

  function open() {
    clear(retry);
    retry = undefined;
    source?.close();
    const current = createEventSource(options.url);
    source = current;
    watchSilence();
    current.addEventListener("snapshot", (event) => {
      if (stopped || current !== source) {
        return;
      }
      watchSilence();
      setStatus("live");
      options.onSnapshot(JSON.parse(event.data) as Snapshot);
    });
    current.onerror = () => {
      if (stopped || current !== source) {
        return;
      }
      setStatus("reconnecting");
      // Still connecting means the browser is retrying; closed means it gave up.
      if (current.readyState === CLOSED && retry === undefined) {
        clear(stale);
        retry = timers.setTimeout(open, retryMs);
      }
    };
  }

  setStatus("connecting");
  open();

  return () => {
    stopped = true;
    clear(stale);
    clear(retry);
    source?.close();
  };
}
