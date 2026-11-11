import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const STARTUP_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
// The hub and Vite reject `--port 0`, so a free port is asked from the OS and
// released before they bind it. Another process can take it in between; a
// child that dies before readiness on an auto port is retried on a new one.
const FREE_PORT_ATTEMPTS = 3;
const BOARD_LISTENING = /Gambi board listening on (http:\/\/\S+)/;
const VITE_LOCAL = /Local:\s+(http:\/\/\S+?)\/?$/;
// Vite colors its banner even when piped in some terminals.
// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI escape sequences.
const ANSI = /\u001B\[[0-9;]*m/g;

export interface EventOptions {
  ephemeral: boolean;
  fake: boolean;
}

export interface DatabasePlan {
  cleanupDirectory?: string;
  displayPath: string;
  url: string;
}

/** Port 0 means "ask the OS for a free one". */
export interface EventPorts {
  board: number;
  hub: number;
  web: number;
}

export type LineSink = (name: string, line: string, error: boolean) => void;

export interface Child {
  name: string;
  process: Bun.Subprocess<"ignore", "pipe", "pipe">;
  /** Resolves with the first output line that satisfied `readyWhen`. */
  ready: Promise<string>;
}

export interface SpawnChildInput {
  command: string[];
  env?: Record<string, string>;
  name: string;
  readyWhen: (line: string) => boolean;
}

export interface StartEventInput {
  adminToken: string;
  /** Explicit board database URL; otherwise a per-room or ephemeral file. */
  databaseUrl?: string;
  ephemeral: boolean;
  fake: boolean;
  /** Bind address for the hub, the board and the web. */
  host: string;
  /** Explicit hub URL for clients; otherwise derived from the hub's port. */
  hubUrl?: string;
  /**
   * Puts Vite's dependency cache in the ephemeral directory, so parallel runs
   * never write the shared `node_modules/.vite` at the same time.
   */
  isolateViteCache?: boolean;
  onLine: LineSink;
  ports: EventPorts;
  web: boolean;
}

export interface RunningEvent {
  boardUrl: string;
  databaseDisplayPath: string;
  /** Base directory for hosted harness workspaces when ephemeral. */
  gambiHome?: string;
  hubUrl: string;
  roomCode: string;
  /** Removed on stop() when ephemeral. */
  temporaryDirectory?: string;
  webUrl?: string;
}

export function parseEventArgs(args: string[]): EventOptions {
  const unknown = args.filter(
    (argument) => argument !== "--fake" && argument !== "--ephemeral"
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  return {
    ephemeral: args.includes("--ephemeral"),
    fake: args.includes("--fake"),
  };
}

function readPort(
  env: Record<string, string | undefined>,
  name: string,
  fallback: number
): number {
  const raw = env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535`);
  }
  return port;
}

/**
 * The event's known ports. The projector and participants depend on them, so
 * they only move through an explicit environment override.
 */
export function eventPorts(
  env: Record<string, string | undefined> = process.env
): EventPorts {
  return {
    hub: readPort(env, "GAMBI_HUB_PORT", 3000),
    board: readPort(env, "BOARD_PORT", 3001),
    web: readPort(env, "BOARD_WEB_PORT", 3002),
  };
}

function fileUrl(path: string): string {
  return `file:${isAbsolute(path) ? path : resolve(ROOT, path)}`;
}

export async function createDatabasePlan(input: {
  configuredUrl?: string;
  /** Ephemeral runs put the database here instead of a new temp folder. */
  directory?: string;
  ephemeral: boolean;
  roomCode: string;
}): Promise<DatabasePlan> {
  if (input.configuredUrl) {
    return { displayPath: input.configuredUrl, url: input.configuredUrl };
  }
  if (input.ephemeral) {
    const directory =
      input.directory ?? (await mkdtemp(join(tmpdir(), "gambi-board-e2e-")));
    const path = join(directory, "board.db");
    return {
      cleanupDirectory: directory,
      displayPath: path,
      url: fileUrl(path),
    };
  }
  const directory = resolve(ROOT, "apps/board/data");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `event-${input.roomCode}.db`);
  return { displayPath: path, url: fileUrl(path) };
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

export function prefixedLine(name: string, line: string, error = false) {
  const output = `[${name}] ${line}\n`;
  if (error) {
    process.stderr.write(output);
  } else {
    process.stdout.write(output);
  }
}

function ignorePromise(promise: Promise<unknown>) {
  promise.catch((error) => prefixedLine("event", String(error), true));
}

async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void
) {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: reads the child's output stream one chunk at a time.
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

export async function withTimeout<T>(
  promise: Promise<T>,
  milliseconds: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function createRoom(hubUrl: string): Promise<string> {
  const response = await fetch(`${hubUrl}/v1/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: `Gambiarra ${new Date().toISOString()}` }),
  });
  const body = (await response.json()) as {
    data?: { room?: { code?: string } };
    error?: { message?: string };
  };
  if (!(response.ok && body.data?.room?.code)) {
    throw new Error(
      body.error?.message ?? `Room creation failed with ${response.status}`
    );
  }
  return body.data.room.code;
}

// Each child leads its own process group (`detached: true`). Signal the whole
// group: the gambi npm wrapper, Vite and the board all start grandchildren
// (the platform binary, esbuild, ACP agents), and a supervisor that signals
// only the leader can leave one of them running.
function signalChild(child: Child, signal: NodeJS.Signals) {
  try {
    process.kill(-child.process.pid, signal);
  } catch {
    child.process.kill(signal);
  }
}

export async function stopChild(child: Child, onLine: LineSink) {
  if (child.process.exitCode === null && child.process.signalCode === null) {
    signalChild(child, "SIGTERM");
    try {
      await withTimeout(
        child.process.exited,
        SHUTDOWN_TIMEOUT_MS,
        `${child.name} did not stop after SIGTERM`
      );
    } catch (error) {
      onLine(child.name, String(error), true);
      signalChild(child, "SIGKILL");
      await child.process.exited;
    }
  }
  // The leader may exit first; reap whatever is left of its group.
  try {
    process.kill(-child.process.pid, "SIGKILL");
  } catch {
    // The group is already gone.
  }
}

/**
 * Starts and stops the event's processes. stop() is safe to call at any
 * point, including while start() is still running.
 */
export class EventSupervisor {
  readonly #children: Child[] = [];
  readonly #input: StartEventInput;
  #board: Child | undefined;
  #boardEnv: Record<string, string> = {};
  #failUnexpected: (error: Error) => void = () => undefined;
  // Widened to boolean: Biome narrows the field to its `false` initializer and
  // misses that restartBoard() flips it at runtime.
  #restartingBoard = false as boolean;
  #stopping: Promise<void> | undefined;
  #temporaryDirectory: string | undefined;
  /** Resolves with the reason when a child exits on its own. */
  readonly unexpectedExit: Promise<Error>;

  constructor(input: StartEventInput) {
    this.#input = input;
    this.unexpectedExit = new Promise<Error>((resolvePromise) => {
      this.#failUnexpected = resolvePromise;
    });
  }

  get stopping() {
    return this.#stopping !== undefined;
  }

  /** Process group leaders of every child started so far. */
  pids(): number[] {
    return this.#children.map((child) => child.process.pid);
  }

  pidOf(name: string): number | undefined {
    return this.#children.find((child) => child.name === name)?.process.pid;
  }

  spawn(input: SpawnChildInput): Child {
    if (this.#stopping) {
      throw new Error("The event is stopping");
    }
    let resolveReady: (line: string) => void;
    let rejectReady: (error: Error) => void;
    let readyFound = false;
    const ready = new Promise<string>((resolvePromise, rejectPromise) => {
      resolveReady = resolvePromise;
      rejectReady = rejectPromise;
    });
    // A child that never becomes ready must not crash the supervisor.
    ready.catch(() => undefined);
    const childProcess = Bun.spawn(input.command, {
      cwd: ROOT,
      detached: true,
      env: { ...process.env, ...input.env },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const inspect = (error: boolean) => (line: string) => {
      this.#input.onLine(input.name, line, error);
      if (!readyFound && input.readyWhen(line.replace(ANSI, ""))) {
        readyFound = true;
        resolveReady(line.replace(ANSI, ""));
      }
    };
    const { onLine } = this.#input;
    pump(childProcess.stdout, inspect(false)).catch((error) =>
      onLine(input.name, String(error), true)
    );
    pump(childProcess.stderr, inspect(true)).catch((error) =>
      onLine(input.name, String(error), true)
    );
    const child: Child = { name: input.name, process: childProcess, ready };
    this.#children.push(child);
    childProcess.exited.then((exitCode) => {
      if (!readyFound) {
        rejectReady(
          new Error(
            `${input.name} exited with code ${exitCode} before readiness`
          )
        );
        return;
      }
      if (
        !(this.#stopping || (this.#restartingBoard && child === this.#board))
      ) {
        this.#failUnexpected(
          new Error(`${input.name} exited unexpectedly with code ${exitCode}`)
        );
      }
    });
    return child;
  }

  async waitReady(child: Child): Promise<string> {
    return await withTimeout(
      child.ready,
      STARTUP_TIMEOUT_MS,
      `${child.name} did not become ready within ${STARTUP_TIMEOUT_MS}ms`
    );
  }

  /** Stops a child started by spawn() and forgets it. */
  async stopOne(child: Child) {
    await stopChild(child, this.#input.onLine);
    const index = this.#children.indexOf(child);
    if (index >= 0) {
      this.#children.splice(index, 1);
    }
  }

  // Ports given as 0 are picked here and retried when the child dies before
  // readiness, which is what losing the race for the port looks like.
  private async startOnPort(
    requested: number,
    start: (port: number) => SpawnChildInput
  ): Promise<{ child: Child; line: string; port: number }> {
    for (let attempt = 1; ; attempt += 1) {
      const port = requested === 0 ? freePort() : requested;
      const child = this.spawn(start(port));
      try {
        // biome-ignore lint/performance/noAwaitInLoops: each attempt needs the previous one to fail first.
        const line = await this.waitReady(child);
        return { child, line, port };
      } catch (error) {
        await this.stopOne(child);
        if (requested !== 0 || attempt >= FREE_PORT_ATTEMPTS || this.stopping) {
          throw error;
        }
      }
    }
  }

  private assertRunning() {
    if (this.#stopping) {
      throw new Error("The event stopped during startup");
    }
  }

  async start(): Promise<RunningEvent> {
    const input = this.#input;
    if (input.ephemeral) {
      this.#temporaryDirectory = await mkdtemp(
        join(tmpdir(), "gambi-board-e2e-")
      );
    }

    const hub = await this.startOnPort(input.ports.hub, (port) => ({
      name: "hub",
      command: [
        "bun",
        "run",
        "dev:cli",
        "--",
        "hub",
        "serve",
        "--host",
        input.host,
        "--port",
        String(port),
        "--format",
        "ndjson",
      ],
      readyWhen: (line) => line.includes('"type":"started"'),
    }));
    const hubUrl = input.hubUrl ?? `http://127.0.0.1:${hub.port}`;
    this.assertRunning();

    const roomCode = await createRoom(hubUrl);
    const database = await createDatabasePlan({
      configuredUrl: input.databaseUrl,
      directory: this.#temporaryDirectory,
      ephemeral: input.ephemeral,
      roomCode,
    });
    this.assertRunning();

    if (input.fake) {
      const fixtures = [
        {
          name: "model-a",
          id: "event-model-a",
          model: "bairro-a",
          nickname: "Modelo Bairro A",
          port: process.env.BOARD_FIXTURE_MODEL_A_PORT ?? "0",
        },
        {
          name: "model-b",
          id: "event-model-b",
          model: "bairro-b",
          nickname: "Modelo Bairro B",
          port: process.env.BOARD_FIXTURE_MODEL_B_PORT ?? "0",
        },
      ];
      for (const fixture of fixtures) {
        const child = this.spawn({
          name: fixture.name,
          command: ["bun", "run", "scripts/event-model-fixture.ts"],
          env: {
            FIXTURE_MODEL: fixture.model,
            FIXTURE_NICKNAME: fixture.nickname,
            FIXTURE_PARTICIPANT_ID: fixture.id,
            FIXTURE_PORT: fixture.port,
            GAMBI_HUB_URL: hubUrl,
            GAMBI_ROOM_CODE: roomCode,
          },
          readyWhen: (line) => line.includes('"type":"ready"'),
        });
        // biome-ignore lint/performance/noAwaitInLoops: fixtures start one at a time so a failed one stops startup before the next spawns.
        await this.waitReady(child);
      }
    }

    const gambiHome = this.#temporaryDirectory
      ? join(this.#temporaryDirectory, "gambi-home")
      : undefined;
    this.#boardEnv = {
      BOARD_ADMIN_TOKEN: input.adminToken,
      BOARD_DATABASE_URL: database.url,
      BOARD_HOST: input.host,
      BOARD_HOSTED_HARNESS: input.fake ? "fake" : "opencode",
      BOARD_PORT: String(input.ports.board),
      GAMBI_HUB_URL: hubUrl,
      GAMBI_ROOM_CODE: roomCode,
      ...(gambiHome ? { BOARD_GAMBI_HOME: gambiHome } : {}),
    };
    const boardLine = await this.startBoard();
    const boardPort = new URL(
      BOARD_LISTENING.exec(boardLine)?.[1] ?? "http://127.0.0.1"
    ).port;
    const boardUrl = `http://127.0.0.1:${boardPort}`;
    this.assertRunning();

    let webUrl: string | undefined;
    if (input.web) {
      const web = await this.startOnPort(input.ports.web, (port) => ({
        name: "web",
        command: ["bun", "run", "--cwd", "apps/board-web", "dev"],
        env: {
          BOARD_PROXY_URL: boardUrl,
          BOARD_WEB_HOST: input.host,
          BOARD_WEB_PORT: String(port),
          ...(input.isolateViteCache && this.#temporaryDirectory
            ? {
                BOARD_WEB_CACHE_DIR: join(this.#temporaryDirectory, "vite"),
              }
            : {}),
          VITE_BOARD_ENABLE_FAKE_HARNESS: input.fake ? "1" : "0",
        },
        readyWhen: (line) =>
          line.includes("Local:") && line.includes(`:${port}`),
      }));
      webUrl = VITE_LOCAL.exec(web.line)?.[1] ?? `http://localhost:${web.port}`;
    }

    return {
      boardUrl,
      databaseDisplayPath: database.displayPath,
      gambiHome,
      hubUrl,
      roomCode,
      temporaryDirectory: this.#temporaryDirectory,
      webUrl,
    };
  }

  private async startBoard(): Promise<string> {
    const board = this.spawn({
      name: "board",
      command: ["bun", "run", "--cwd", "apps/board", "src/index.ts"],
      env: this.#boardEnv,
      readyWhen: (line) => BOARD_LISTENING.test(line),
    });
    const readyLine = await this.waitReady(board);
    this.#board = board;
    return readyLine;
  }

  /** Restarts only the board, on the port it already had. */
  async restartBoard() {
    if (this.#restartingBoard || this.#stopping || !this.#board) {
      return;
    }
    this.#restartingBoard = true;
    try {
      const previous = this.#board;
      const port = BOARD_LISTENING.exec(await previous.ready)?.[1];
      await this.stopOne(previous);
      if (port) {
        this.#boardEnv.BOARD_PORT = new URL(port).port;
      }
      await this.startBoard();
    } finally {
      this.#restartingBoard = false;
    }
  }

  /** Stops every child in reverse start order and removes temp files. */
  stop(): Promise<void> {
    this.#stopping ??= (async () => {
      for (const child of [...this.#children].reverse()) {
        // biome-ignore lint/performance/noAwaitInLoops: children stop in reverse start order, so the board goes down before the hub it depends on.
        await stopChild(child, this.#input.onLine);
      }
      this.#children.length = 0;
      if (this.#temporaryDirectory) {
        await rm(this.#temporaryDirectory, { recursive: true, force: true });
      }
    })();
    return this.#stopping;
  }
}

async function main() {
  const options = parseEventArgs(process.argv.slice(2));
  const adminToken = process.env.BOARD_ADMIN_TOKEN ?? "gambi-local-admin";
  const ports = eventPorts();
  const supervisor = new EventSupervisor({
    adminToken,
    databaseUrl: process.env.BOARD_DATABASE_URL,
    ephemeral: options.ephemeral,
    fake: options.fake,
    host: "0.0.0.0",
    hubUrl:
      process.env.GAMBI_HUB_URL ??
      (ports.hub === 0 ? undefined : `http://127.0.0.1:${ports.hub}`),
    onLine: prefixedLine,
    ports,
    web: true,
  });

  const shutdown = async (exitCode: number) => {
    await supervisor.stop();
    process.exit(exitCode);
  };
  process.once("SIGINT", () => ignorePromise(shutdown(0)));
  process.once("SIGTERM", () => ignorePromise(shutdown(0)));

  try {
    const running = await supervisor.start();
    process.on("SIGUSR1", () => {
      prefixedLine("event", "Restarting only the board after SIGUSR1");
      supervisor
        .restartBoard()
        .then(() => prefixedLine("event", "Board restart complete"))
        .catch(async (error) => {
          prefixedLine("event", String(error), true);
          await shutdown(1);
        });
    });

    const webUrl = running.webUrl ?? "http://localhost:3002";
    const webPort = new URL(webUrl).port;
    process.stdout.write(
      [
        "",
        `Gambi ${options.fake ? "E2E" : "event"} ready`,
        `Room: ${running.roomCode}`,
        `Admin: http://localhost:${webPort}/admin?token=${adminToken}`,
        `Projector: http://localhost:${webPort}/`,
        `Database: ${running.databaseDisplayPath}`,
        ...(running.gambiHome ? [`Workspaces: ${running.gambiHome}`] : []),
        `Board-only restart: kill -USR1 ${process.pid}`,
        "Stop everything: Ctrl+C",
        "",
      ].join("\n")
    );

    const exitReason = await supervisor.unexpectedExit;
    process.stderr.write(`${exitReason.message}\n`);
    await shutdown(1);
  } catch (error) {
    if (supervisor.stopping) {
      return;
    }
    process.stderr.write(
      `Event startup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    await shutdown(1);
  }
}

if (import.meta.main) {
  await main();
}
