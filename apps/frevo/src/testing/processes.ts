// Child processes for tests, the smoke and the dev command: every port is
// asked from the OS and every hub gets its own HOME, so several runs can share
// one machine.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const APP_ROOT = resolve(import.meta.dir, "../..");
const STOP_TIMEOUT_MS = 10_000;
const FREE_PORT_ATTEMPTS = 3;

export type LineSink = (line: string, error: boolean) => void;

export interface RunningProcess {
  exited: Promise<number>;
  pid: number;
  /** The first output line that satisfied `readyWhen`. */
  ready: Promise<string>;
  /** SIGTERM to the whole process group, SIGKILL after a grace period. */
  stop: () => Promise<void>;
}

export interface SpawnInput {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  onLine?: LineSink;
  readyTimeoutMs?: number;
  readyWhen: (line: string) => boolean;
}

/** Asks the OS for a port that is free on every interface, then frees it. */
export function freePort(): number {
  const listener = Bun.listen({
    hostname: "0.0.0.0",
    port: 0,
    socket: { data: () => undefined },
  });
  const { port } = listener;
  listener.stop(true);
  return port;
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: reads the child's output one chunk at a time.
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    pending += value;
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line) {
        onLine(line);
      }
    }
  }
  if (pending) {
    onLine(pending);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {
    // The group is already gone.
  }
}

/** Starts a child that leads its own process group, so stop() reaches grandchildren. */
export function spawnProcess(input: SpawnInput): RunningProcess {
  const child = Bun.spawn(input.command, {
    cwd: input.cwd ?? APP_ROOT,
    detached: true,
    env: { ...process.env, ...input.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let isReady = false;
  const tail: string[] = [];
  const ready = new Promise<string>((resolveReady, rejectReady) => {
    const timer = setTimeout(
      () =>
        rejectReady(
          new Error(`${input.command.join(" ")} did not become ready`)
        ),
      input.readyTimeoutMs ?? 30_000
    );
    const inspect = (error: boolean) => (line: string) => {
      input.onLine?.(line, error);
      tail.push(line);
      if (tail.length > 20) {
        tail.shift();
      }
      if (!isReady && input.readyWhen(line)) {
        isReady = true;
        clearTimeout(timer);
        resolveReady(line);
      }
    };
    pump(child.stdout, inspect(false)).catch(() => undefined);
    pump(child.stderr, inspect(true)).catch(() => undefined);
    child.exited.then((code) => {
      clearTimeout(timer);
      if (!isReady) {
        rejectReady(
          new Error(
            `${input.command.join(" ")} exited with code ${code} before readiness:\n${tail.join("\n")}`
          )
        );
      }
    });
  });
  // A child that never becomes ready must not crash whoever is not waiting.
  ready.catch(() => undefined);

  let stopping: Promise<void> | undefined;
  return {
    pid: child.pid,
    exited: child.exited,
    ready,
    stop() {
      stopping ??= (async () => {
        if (child.exitCode === null && child.signalCode === null) {
          signalGroup(child.pid, "SIGTERM");
          const timer = setTimeout(
            () => signalGroup(child.pid, "SIGKILL"),
            STOP_TIMEOUT_MS
          );
          await child.exited;
          clearTimeout(timer);
        }
        signalGroup(child.pid, "SIGKILL");
      })();
      return stopping;
    },
  };
}

export interface RunningHub {
  port: number;
  /** Stops the hub and starts a new one on the same port; every Room is gone. */
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  url: string;
}

/**
 * Starts `gambi hub serve` on a free port (or `port`) with a throwaway HOME.
 * The hub rejects `--port 0`, so a free port is picked and released first; a
 * hub that dies before readiness lost the race for it and is retried.
 */
export async function startHub(
  options: { host?: string; onLine?: LineSink; port?: number } = {}
): Promise<RunningHub> {
  const host = options.host ?? "127.0.0.1";
  const home = await mkdtemp(join(tmpdir(), "frevo-hub-home-"));
  const serve = (onPort: number) =>
    spawnProcess({
      command: [
        "bun",
        "x",
        "gambi",
        "hub",
        "serve",
        "--host",
        host,
        "--port",
        String(onPort),
        "--format",
        "ndjson",
        "--no-interactive",
      ],
      env: { HOME: home, GAMBI_NO_INTERACTIVE: "1" },
      onLine: options.onLine,
      readyWhen: (line) => line.includes('"type":"started"'),
    });

  let port = options.port ?? 0;
  let child: RunningProcess | undefined;
  for (let attempt = 1; !child; attempt += 1) {
    const candidate = port === 0 ? freePort() : port;
    const started = serve(candidate);
    try {
      // biome-ignore lint/performance/noAwaitInLoops: each attempt needs the previous one to fail first.
      await started.ready;
      child = started;
      port = candidate;
    } catch (error) {
      await started.stop();
      if (options.port || attempt >= FREE_PORT_ATTEMPTS) {
        await rm(home, { recursive: true, force: true });
        throw error;
      }
    }
  }

  let current = child;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async restart() {
      await current.stop();
      current = serve(port);
      await current.ready;
    },
    async stop() {
      await current.stop();
      await rm(home, { recursive: true, force: true });
    },
  };
}
