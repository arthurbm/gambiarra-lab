#!/usr/bin/env bun
// Bloco de frevo on one machine with one command: the hub, the world server,
// the model host and the web.
//
//   bun run frevo:dev             fake models, no key, no network
//   bun run frevo:dev -- --real   models from OpenRouter (spends money)
//
// Ports: PORT (world, 3200), FREVO_WEB_PORT (web, 3201) and FREVO_HUB_PORT
// (hub, 3210); 0 asks the OS for a free one. FREVO_MODELS and FREVO_BONECOS
// pass through to the model host and the world.
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import {
  freePort,
  type RunningHub,
  type RunningProcess,
  spawnProcess,
  startHub,
} from "../apps/frevo/src/testing/processes";

const ROOT = resolve(import.meta.dir, "..");
const WORLD_LISTENING = /Frevo world listening on http:\/\/\S+:(\d+)/;
const FREE_PORT_ATTEMPTS = 3;

export type FrevoLineSink = (
  name: string,
  line: string,
  error: boolean
) => void;

export interface FrevoOptions {
  /** Extra environment for the world server and the model host. */
  env?: Record<string, string>;
  /** Bind address for the hub, the world and the web. */
  host: string;
  onLine: FrevoLineSink;
  /** 0 asks the OS for a free port. */
  ports: { hub: number; web: number; world: number };
  /** Real models from OpenRouter instead of the fake one. */
  real: boolean;
  roomName: string;
  /** Start the Vite dev server. */
  web: boolean;
}

export interface RunningFrevo {
  hub: RunningHub;
  hubUrl: string;
  /** Kills the model host without warning and forgets it (failure drill). */
  killModelHost: () => Promise<void>;
  /** Process group leaders, for checks after stop(). */
  pids: () => number[];
  startModelHost: () => Promise<void>;
  stop: () => Promise<void>;
  /** Resolves with the reason when a child exits on its own. */
  unexpectedExit: Promise<Error>;
  webUrl?: string;
  worldUrl: string;
}

export function prefixed(name: string, line: string, error = false) {
  (error ? process.stderr : process.stdout).write(`[${name}] ${line}\n`);
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`${name} must be an integer from 0 to 65535`);
  }
  return port;
}

export async function startFrevo(options: FrevoOptions): Promise<RunningFrevo> {
  const children = new Map<string, RunningProcess>();
  let stopping: Promise<void> | undefined;
  let failUnexpected: (error: Error) => void = () => undefined;
  const unexpectedExit = new Promise<Error>((resolveExit) => {
    failUnexpected = resolveExit;
  });

  function track(name: string, child: RunningProcess) {
    children.set(name, child);
    child.exited.then((code) => {
      if (!stopping && children.get(name) === child) {
        failUnexpected(
          new Error(`${name} exited unexpectedly with code ${code}`)
        );
      }
    });
    return child;
  }

  const hub = await startHub({
    host: options.host,
    port: options.ports.hub || undefined,
    onLine: (line, error) => options.onLine("hub", line, error),
  });
  const hubUrl = hub.url;
  const shared = {
    ...options.env,
    GAMBI_HUB_URL: hubUrl,
    FREVO_ROOM_NAME: options.roomName,
    // The world reads it too, to give the simulated bonecos the same models.
    FREVO_MODEL_HOST_MODE: options.real ? "openrouter" : "fake",
  };

  async function stop() {
    stopping ??= (async () => {
      for (const child of [...children.values()].reverse()) {
        // biome-ignore lint/performance/noAwaitInLoops: children stop in reverse start order.
        await child.stop();
      }
      await hub.stop();
    })();
    await stopping;
  }

  try {
    const world = track(
      "world",
      spawnProcess({
        command: ["bun", "run", "apps/frevo/src/server/index.ts"],
        cwd: ROOT,
        env: {
          ...shared,
          HOST: options.host,
          PORT: String(options.ports.world),
        },
        onLine: (line, error) => options.onLine("world", line, error),
        readyWhen: (line) => WORLD_LISTENING.test(line),
      })
    );
    const worldPort = WORLD_LISTENING.exec(await world.ready)?.[1];
    const worldUrl = `http://127.0.0.1:${worldPort}`;

    const startModelHost = async () => {
      const modelHost = track(
        "models",
        spawnProcess({
          command: ["bun", "run", "apps/frevo/src/model-host/index.ts"],
          cwd: ROOT,
          env: shared,
          onLine: (line, error) => options.onLine("models", line, error),
          readyWhen: (line) => line.includes('"type":"joined"'),
        })
      );
      await modelHost.ready;
    };
    await startModelHost();

    let webUrl: string | undefined;
    for (let attempt = 1; options.web && !webUrl; attempt += 1) {
      const port = options.ports.web || freePort();
      const web = spawnProcess({
        command: ["bun", "run", "--cwd", "apps/frevo-web", "dev"],
        cwd: ROOT,
        env: {
          FREVO_WEB_HOST: options.host,
          FREVO_WEB_PORT: String(port),
          FREVO_WORLD_URL: worldUrl,
        },
        onLine: (line, error) => options.onLine("web", line, error),
        readyWhen: (line) =>
          line.includes("Local:") && line.includes(`:${port}`),
      });
      try {
        // biome-ignore lint/performance/noAwaitInLoops: a new attempt only starts after the previous one lost its port.
        await web.ready;
        track("web", web);
        webUrl = `http://localhost:${port}`;
      } catch (error) {
        await web.stop();
        if (options.ports.web || attempt >= FREE_PORT_ATTEMPTS) {
          throw error;
        }
      }
    }

    return {
      hub,
      hubUrl,
      worldUrl,
      webUrl,
      unexpectedExit,
      startModelHost,
      pids: () => [...children.values()].map((child) => child.pid),
      async killModelHost() {
        const modelHost = children.get("models");
        children.delete("models");
        if (modelHost) {
          try {
            process.kill(-modelHost.pid, "SIGKILL");
          } catch {
            // Already gone.
          }
          await modelHost.exited;
        }
      },
      stop,
    };
  } catch (error) {
    await stop();
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter(
    (argument) => !["--real", "--no-web"].includes(argument)
  );
  if (unknown.length > 0) {
    throw new Error(`Unknown option: ${unknown.join(", ")}`);
  }
  const real = args.includes("--real");

  let running: RunningFrevo | undefined;
  let interrupted = false;
  const shutdown = async (exitCode: number) => {
    interrupted = true;
    await running?.stop();
    process.exit(exitCode);
  };
  process.once("SIGINT", () => shutdown(0));
  process.once("SIGTERM", () => shutdown(0));

  // The admin link must open; a secret is drawn for this run unless one is set.
  const adminSecret =
    process.env.FREVO_ADMIN_SECRET?.trim() || randomBytes(16).toString("hex");

  try {
    running = await startFrevo({
      env: { FREVO_ADMIN_SECRET: adminSecret },
      host: process.env.HOST?.trim() || "0.0.0.0",
      onLine: prefixed,
      ports: {
        hub: readPort("FREVO_HUB_PORT", 3210),
        world: readPort("PORT", 3200),
        web: readPort("FREVO_WEB_PORT", 3201),
      },
      real,
      roomName: process.env.FREVO_ROOM_NAME?.trim() || "bloco-de-frevo",
      web: !args.includes("--no-web"),
    });
    if (interrupted) {
      await running.stop();
      return;
    }
    const pages = running.webUrl ?? running.worldUrl;
    process.stdout.write(
      [
        "",
        `Bloco de frevo ready (${real ? "real models from OpenRouter" : "fake models"})`,
        `Telão:   ${pages}/telao`,
        `Celular: ${pages}/`,
        `Admin:   ${pages}/admin?k=${adminSecret}`,
        `World:   ${running.worldUrl}/health`,
        `Hub:     ${running.hubUrl}`,
        "Stop everything: Ctrl+C",
        "",
      ].join("\n")
    );
    const reason = await running.unexpectedExit;
    process.stderr.write(`${reason.message}\n`);
    await shutdown(1);
  } catch (error) {
    if (interrupted) {
      return;
    }
    process.stderr.write(
      `Frevo startup failed: ${error instanceof Error ? error.message : String(error)}\n`
    );
    await shutdown(1);
  }
}

if (import.meta.main) {
  await main();
}
