#!/usr/bin/env bun
// A runtime proof of the Bloco de frevo that exits on its own. It builds the
// web, starts the hub, the world server and the model host (fake model) on
// free ports, watches a boneco decide by a model of the Room, then drills the
// failures the event has to survive: the model host dies, the hub restarts,
// the telão reconnects. Exit 0 when every step passed, 1 at the first failure.
// FREVO_SMOKE_VERBOSE=1 streams the children's output.
import { exists, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  DEFAULT_FAKE_MODELS,
  parseModels,
} from "../apps/frevo/src/models/catalog";
import type { PublicSnapshot } from "../apps/frevo/src/sim/world";
import { openEventStream } from "../apps/frevo/src/testing/sse";
import { until } from "../apps/frevo/src/testing/until";
import { prefixed, type RunningFrevo, startFrevo } from "./frevo";

const ROOT = resolve(import.meta.dir, "..");
const TOTAL_TIMEOUT_MS = Number(process.env.FREVO_SMOKE_TIMEOUT_MS || 180_000);
const STEP_TIMEOUT_MS = 45_000;
const TAIL_LINES = 40;
const VERBOSE = process.env.FREVO_SMOKE_VERBOSE === "1";
const LLM_EVENT = /\[gambi\] (llm\.\w+)/;
const FAKE_PARTICIPANTS = parseModels(DEFAULT_FAKE_MODELS).reduce(
  (sum, spec) => sum + spec.participants,
  0
);

class StepFailure extends Error {}

interface Health {
  bonecos: number;
  ok: boolean;
  participants: number;
  room: string | null;
}

const logs = new Map<string, string[]>();
const llmEvents: string[] = [];
const startedAt = performance.now();
let failed = false;
let running: RunningFrevo | undefined;
let temporary: string | undefined;

function onLine(name: string, line: string, error: boolean) {
  const event = name === "hub" ? LLM_EVENT.exec(line)?.[1] : undefined;
  if (event) {
    llmEvents.push(event);
  }
  const tail = logs.get(name) ?? [];
  tail.push(line);
  if (tail.length > TAIL_LINES) {
    tail.shift();
  }
  logs.set(name, tail);
  if (VERBOSE) {
    prefixed(name, line, error);
  }
}

function seconds(fromMs: number) {
  return `${((performance.now() - fromMs) / 1000).toFixed(1)}s`;
}

function print(line: string) {
  process.stdout.write(`${line}\n`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`timed out after ${ms / 1000}s`)),
        ms
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

async function step(
  name: string,
  run: () => Promise<string | undefined>,
  watchChildren = true
) {
  const stepStartedAt = performance.now();
  try {
    const timed = withTimeout(run(), STEP_TIMEOUT_MS);
    const detail = await (watchChildren && running
      ? Promise.race([
          timed,
          running.unexpectedExit.then((error) => {
            throw error;
          }),
        ])
      : timed);
    print(
      `ok    ${name.padEnd(34)} ${seconds(stepStartedAt).padStart(6)}${detail ? `  ${detail}` : ""}`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!finishing) {
      print(
        `FAIL  ${name.padEnd(34)} ${seconds(stepStartedAt).padStart(6)}  ${reason}`
      );
    }
    throw new StepFailure(reason, { cause: error });
  }
}

function frevo() {
  assert(running, "the frevo is not running");
  return running;
}

async function health(): Promise<Health> {
  const response = await fetch(`${frevo().worldUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  });
  assert(response.status === 200, `GET /health answered ${response.status}`);
  return (await response.json()) as Health;
}

function telao() {
  return openEventStream<PublicSnapshot>(`${frevo().worldUrl}/events/telao`);
}

function firstBoneco(snapshot: PublicSnapshot) {
  const [boneco] = snapshot.bonecos;
  assert(boneco, "the snapshot has no boneco");
  return boneco;
}

/** Watches the telão until the boneco is in the state `match` describes. */
async function watchBoneco(
  match: (boneco: PublicSnapshot["bonecos"][number]) => boolean,
  laterThanMs = 0
) {
  const stream = await telao();
  try {
    return await stream.find(
      (snapshot) =>
        snapshot.timeMs > laterThanMs && match(firstBoneco(snapshot)),
      STEP_TIMEOUT_MS
    );
  } finally {
    stream.close();
  }
}

function completions() {
  return llmEvents.filter((event) => event === "llm.complete").length;
}

/**
 * Waits for a tool call the hub completed after `completedBefore`, then for
 * the telão to show a boneco that a model decided for. A boneco still showing
 * an old decision is not enough: the hub has to have answered a new one.
 */
async function modelDecidesAfter(completedBefore: number) {
  await until(
    () => Promise.resolve(completions() > completedBefore ? true : undefined),
    STEP_TIMEOUT_MS
  );
  return await watchBoneco(
    (boneco) => boneco.brain === "model" && boneco.speech !== null
  );
}

async function scenario() {
  await step(
    "build the web",
    async () => {
      temporary = await mkdtemp(join(tmpdir(), "frevo-smoke-"));
      const dist = join(temporary, "web");
      const build = Bun.spawn(
        ["bun", "x", "vite", "build", "--outDir", dist, "--emptyOutDir"],
        {
          cwd: join(ROOT, "apps/frevo-web"),
          stdout: "pipe",
          stderr: "pipe",
        }
      );
      const [code, output, errors] = await Promise.all([
        build.exited,
        new Response(build.stdout).text(),
        new Response(build.stderr).text(),
      ]);
      assert(code === 0, `vite build exited with ${code}: ${output}${errors}`);
      assert(await exists(join(dist, "index.html")), "no index.html was built");
      return dist;
    },
    false
  );

  await step("start hub, world and model host", async () => {
    running = await startFrevo({
      env: {
        FREVO_BONECOS: "1",
        FREVO_DECISION_TIMEOUT_MS: "3000",
        FREVO_FAKE_LATENCY_MS: "200",
        FREVO_FAKE_FAILURES: "0",
        FREVO_WEB_DIST: join(temporary as string, "web"),
      },
      host: "127.0.0.1",
      onLine,
      ports: { hub: 0, world: 0, web: 0 },
      real: false,
      roomName: `frevo-smoke-${process.pid}`,
      web: false,
    });
    return `hub ${running.hubUrl} world ${running.worldUrl}`;
  });

  let firstRoom = "";
  await step("the Room has the model participants", async () => {
    const ready = await until(async () => {
      const current = await health();
      return current.room && current.participants === FAKE_PARTICIPANTS
        ? current
        : undefined;
    }, STEP_TIMEOUT_MS);
    firstRoom = ready.room as string;
    return `room ${ready.room}, ${ready.participants} participants, ${ready.bonecos} boneco`;
  });

  await step("the world serves the web", async () => {
    for (const route of ["/telao", "/", "/admin"]) {
      // biome-ignore lint/performance/noAwaitInLoops: three small requests in order.
      const page = await fetch(`${frevo().worldUrl}${route}`);
      assert(page.status === 200, `GET ${route} answered ${page.status}`);
      assert(
        (await page.text()).includes('<div id="app">'),
        `GET ${route} is not the web page`
      );
    }
    return "GET /telao, / and /admin 200";
  });

  let lastSeenMs = 0;
  await step("a boneco decides by a Room model", async () => {
    const spoke = await watchBoneco(
      (talking) => talking.brain === "model" && talking.speech !== null
    );
    const boneco = firstBoneco(spoke);
    const moved = await watchBoneco(
      (later) => Math.hypot(later.x - boneco.x, later.y - boneco.y) > 3,
      spoke.timeMs
    );
    lastSeenMs = moved.timeMs;
    return `${boneco.name} via ${boneco.model}: "${boneco.speech}", then walked`;
  });

  await step("hub saw the tool call", async () => {
    await until(
      () => Promise.resolve(completions() > 0 ? true : undefined),
      STEP_TIMEOUT_MS
    );
    const errors = llmEvents.filter((event) => event === "llm.error").length;
    assert(errors === 0, `the hub logged ${errors} llm.error`);
    return `${completions()} llm.complete, 0 llm.error`;
  });

  await step("the telão's panel counts the model", async () => {
    const stream = await openEventStream<
      PublicSnapshot & { models?: { decisions: number; label: string }[] }
    >(`${frevo().worldUrl}/events/telao`);
    try {
      const counted = await stream.find(
        (snapshot) => (snapshot.models ?? []).some((row) => row.decisions > 0),
        STEP_TIMEOUT_MS
      );
      const rows = (counted.models ?? []).filter((row) => row.decisions > 0);
      return rows.map((row) => `${row.label} ${row.decisions}`).join(", ");
    } finally {
      stream.close();
    }
  });

  await step("model host dies: autopilot", async () => {
    await frevo().killModelHost();
    const walking = await watchBoneco(
      (boneco) => boneco.brain === "autopilot" && boneco.walking,
      lastSeenMs
    );
    return `${firstBoneco(walking).name} keeps walking with no model`;
  });

  await step("model host returns: models decide", async () => {
    const before = completions();
    await frevo().startModelHost();
    const decided = await modelDecidesAfter(before);
    return `via ${firstBoneco(decided).model}`;
  });

  await step("hub restarts: Room and host come back", async () => {
    const before = completions();
    await frevo().hub.restart();
    const recovered = await until(async () => {
      const current = await health();
      return current.room &&
        current.room !== firstRoom &&
        current.participants === FAKE_PARTICIPANTS
        ? current
        : undefined;
    }, STEP_TIMEOUT_MS);
    await modelDecidesAfter(before);
    return `room ${firstRoom} -> ${recovered.room}, ${recovered.participants} participants, a model decided again`;
  });

  await step("the telão reconnects", async () => {
    const first = await telao();
    const before = await first.next();
    first.close();
    const second = await telao();
    try {
      const after = await second.next();
      assert(
        after.timeMs >= before.timeMs,
        `the world went back in time: ${before.timeMs} -> ${after.timeMs}`
      );
      return `new stream starts at the current world (${after.timeMs}ms)`;
    } finally {
      second.close();
    }
  });
}

function groupAlive(pid: number) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function portOpen(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function cleanup() {
  const current = running;
  await step(
    "stop and clean up",
    async () => {
      const pids = current?.pids() ?? [];
      await current?.stop();
      const alive = pids.filter(groupAlive);
      assert(alive.length === 0, `process groups still alive: ${alive}`);
      const open: string[] = [];
      for (const url of [current?.hubUrl, current?.worldUrl]) {
        // biome-ignore lint/performance/noAwaitInLoops: two probes, each bounded.
        if (url && (await portOpen(url))) {
          open.push(url);
        }
      }
      assert(open.length === 0, `still listening: ${open}`);
      if (temporary) {
        await rm(temporary, { recursive: true, force: true });
      }
      return `${pids.length} process groups gone, ports closed, temp dir removed`;
    },
    false
  );
}

function dumpLogs() {
  for (const [name, lines] of logs) {
    process.stderr.write(`--- last ${lines.length} lines of ${name} ---\n`);
    for (const line of lines) {
      process.stderr.write(`  ${line}\n`);
    }
  }
}

let finishing: Promise<never> | undefined;
function finish(reason?: string): Promise<never> {
  finishing ??= (async () => {
    if (reason) {
      failed = true;
      print(`FAIL  ${reason}`);
    }
    if (failed) {
      dumpLogs();
    }
    try {
      await cleanup();
    } catch {
      failed = true;
    }
    print(
      `${failed ? "smoke FAILED" : "smoke passed"} in ${seconds(startedAt)}`
    );
    process.exit(failed ? 1 : 0);
  })();
  return finishing;
}

process.once("SIGINT", () => finish("interrupted by SIGINT"));
process.once("SIGTERM", () => finish("interrupted by SIGTERM"));
const deadline = setTimeout(
  () => finish(`total timeout of ${TOTAL_TIMEOUT_MS / 1000}s`),
  TOTAL_TIMEOUT_MS
);

print(`frevo smoke (total limit ${TOTAL_TIMEOUT_MS / 1000}s)`);
try {
  await scenario();
} catch (error) {
  failed = true;
  if (!(error instanceof StepFailure)) {
    print(`FAIL  ${error instanceof Error ? error.message : String(error)}`);
  }
}
clearTimeout(deadline);
await finish();
