#!/usr/bin/env bun
// A runtime proof of the board that exits on its own. It starts the hub, the
// model fixtures, the board and the web on free ports, drives one hosted
// harness, one brought-by-a-person `fake` harness and the orchestrator over
// oRPC, then stops everything. Exit 0 when every step passed, 1 at the first
// failure. BOARD_SMOKE_VERBOSE=1 streams the children's output;
// BOARD_SMOKE_KILL=<child> kills that child after startup (failure drill).
import { exists, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { cityTileStarterFiles } from "../apps/board/src/starter/city-tile";
import {
  EventSupervisor,
  prefixedLine,
  type RunningEvent,
  withTimeout,
} from "./event";

const TOTAL_TIMEOUT_MS = Number(process.env.BOARD_SMOKE_TIMEOUT_MS || 240_000);
const STEP_TIMEOUT_MS = 60_000;
const START_TIMEOUT_MS = 120_000;
// Six children, each allowed 10s after SIGTERM before SIGKILL.
const STOP_TIMEOUT_MS = 90_000;
const RPC_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;
const TAIL_LINES = 40;
const ADMIN_TOKEN = "gambi-smoke-admin";
const VERBOSE = process.env.BOARD_SMOKE_VERBOSE === "1";
const KILL_CHILD = process.env.BOARD_SMOKE_KILL?.trim();

const HOSTED = "board-hosted-01";
const ANA = { personId: "person-smoke-ana", name: "Ana Smoke" };
const BIA = { personId: "person-smoke-bia", name: "Bia Smoke" };
const BIA_PARTICIPANT = `board-person-${BIA.personId}`;
const SECOND_PROMPT = "Agora adicione uma fonte na praça";
const STARTER_HEADER =
  "Before the task below, set up the city tile starter in your working directory.";
const STARTER_README = cityTileStarterFiles({ harness: "fake", model: "x" })[1]
  ?.content as string;

const LLM_EVENT = /\[gambi\] (llm\.\w+)/;
const LLM_PROTOCOL = /^\s*protocol: "(\w+)"/;

class StepFailure extends Error {}

const logs = new Map<string, string[]>();
const hubLines: string[] = [];
const startedAt = performance.now();
let failed = false;

function onLine(name: string, line: string, error: boolean) {
  if (name === "hub") {
    hubLines.push(line);
  }
  const tail = logs.get(name) ?? [];
  tail.push(line);
  if (tail.length > TAIL_LINES) {
    tail.shift();
  }
  logs.set(name, tail);
  if (VERBOSE) {
    prefixedLine(name, line, error);
  }
}

const supervisor = new EventSupervisor({
  adminToken: ADMIN_TOKEN,
  ephemeral: true,
  fake: true,
  host: "127.0.0.1",
  isolateViteCache: true,
  onLine,
  ports: { hub: 0, board: 0, web: 0 },
  web: true,
});
let running: RunningEvent | undefined;

function seconds(fromMs: number) {
  return `${((performance.now() - fromMs) / 1000).toFixed(1)}s`;
}

function print(line: string) {
  process.stdout.write(`${line}\n`);
}

function dumpLogs() {
  for (const [name, lines] of logs) {
    process.stderr.write(`--- last ${lines.length} lines of ${name} ---\n`);
    for (const line of lines) {
      process.stderr.write(`  ${line}\n`);
    }
  }
}

// A step also fails as soon as a child exits on its own, unless it runs after
// the event stopped (the cleanup check).
async function step(
  name: string,
  timeoutMs: number,
  run: () => Promise<string | undefined>,
  watchChildren = true
) {
  const stepStartedAt = performance.now();
  try {
    const timed = withTimeout(
      run(),
      timeoutMs,
      `timed out after ${timeoutMs / 1000}s`
    );
    const detail = await (watchChildren
      ? Promise.race([
          timed,
          supervisor.unexpectedExit.then((error) => {
            throw error;
          }),
        ])
      : timed);
    print(
      `ok    ${name.padEnd(28)} ${seconds(stepStartedAt).padStart(6)}${detail ? `  ${detail}` : ""}`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (finishing) {
      // Interrupted or out of time: the children are already going down.
      throw new StepFailure(reason, { cause: error });
    }
    print(
      `FAIL  ${name.padEnd(28)} ${seconds(stepStartedAt).padStart(6)}  ${reason}`
    );
    throw new StepFailure(reason, { cause: error });
  }
}

function sleep(milliseconds: number) {
  return new Promise((resolvePromise) =>
    setTimeout(resolvePromise, milliseconds)
  );
}

/** Polls until `check` returns a value; the step timeout bounds it. */
async function until<T>(check: () => Promise<T | undefined>): Promise<T> {
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling waits for the previous check.
    const value = await check();
    if (value !== undefined) {
      return value;
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function boardUrl() {
  assert(running, "the event is not running");
  return running.boardUrl;
}

async function rpc<T>(
  path: string,
  input?: unknown,
  options: { admin?: boolean; baseUrl?: string } = {}
): Promise<T> {
  const response = await fetch(`${options.baseUrl ?? boardUrl()}/rpc/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(options.admin ? { "x-board-admin-token": ADMIN_TOKEN } : {}),
    },
    body: JSON.stringify(input === undefined ? {} : { json: input }),
    signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as {
    json?: { message?: string } & Record<string, unknown>;
  };
  if (!response.ok) {
    throw new Error(
      `${path} answered ${response.status}: ${body.json?.message ?? JSON.stringify(body).slice(0, 300)}`
    );
  }
  return body.json as T;
}

interface HarnessView {
  connected: boolean;
  hosted: boolean;
  participantId: string;
}

interface TileVersionView {
  boardVersion: number;
  readme: string | null;
  sourceParticipantId: string;
  valid: boolean;
  validationError: string | null;
}

async function waitConnected(participantId: string) {
  await until(async () => {
    const harnesses = await rpc<HarnessView[]>("harnesses/list");
    return harnesses.some(
      (harness) => harness.participantId === participantId && harness.connected
    )
      ? true
      : undefined;
  });
}

function workspacePath(participantId: string) {
  assert(running?.gambiHome, "the smoke needs an ephemeral gambiHome");
  return join(running.gambiHome, "workspaces", running.roomCode, participantId);
}

async function readNewOutput(path: string, previous: string | undefined) {
  return await until(async () => {
    const content = await readFile(path, "utf8").catch(() => undefined);
    return content !== undefined && content !== previous ? content : undefined;
  });
}

async function steer(
  squadId: string,
  person: { personId: string },
  participantId: string
) {
  await rpc("harnesses/assign", {
    actorPersonId: person.personId,
    squadId,
    participantId,
  });
  await rpc("harnesses/electSteerer", {
    actorPersonId: person.personId,
    squadId,
    personId: person.personId,
  });
}

function prompt(squadId: string, person: { personId: string }, text: string) {
  return rpc("harnesses/prompt", {
    actorPersonId: person.personId,
    squadId,
    prompt: text,
  });
}

interface LlmBlock {
  kind: string;
  protocol?: string;
}

/** Reads the hub's pretty-printed `[gambi] llm.* { ... }` log blocks. */
function hubLlmBlocks(): LlmBlock[] {
  const blocks: LlmBlock[] = [];
  let current: LlmBlock | undefined;
  for (const line of hubLines) {
    const start = LLM_EVENT.exec(line);
    if (start?.[1]) {
      current = { kind: start[1] };
      blocks.push(current);
      continue;
    }
    const protocol = LLM_PROTOCOL.exec(line);
    if (current && protocol?.[1] && !current.protocol) {
      current.protocol = protocol[1];
    }
    if (line.trim() === "}") {
      current = undefined;
    }
  }
  return blocks;
}

async function scenario() {
  await step("start event", START_TIMEOUT_MS, async () => {
    running = await supervisor.start();
    for (const child of ["hub", "board", "web"]) {
      assert(logs.has(child), `${child} printed nothing`);
    }
    return `room ${running.roomCode} hub ${running.hubUrl} board ${running.boardUrl} web ${running.webUrl}`;
  });
  assert(running, "the event is not running");
  const event = running;

  if (KILL_CHILD) {
    print(`drill: killing ${KILL_CHILD} (BOARD_SMOKE_KILL)`);
    const pid = supervisor.pidOf(KILL_CHILD);
    assert(pid, `no child named ${KILL_CHILD}`);
    process.kill(-pid, "SIGKILL");
  }

  await step("web serves / and proxies", STEP_TIMEOUT_MS, async () => {
    assert(event.webUrl, "the web did not start");
    const page = await fetch(`${event.webUrl}/`, {
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    assert(page.status === 200, `GET / answered ${page.status}`);
    const phase = await rpc<{ currentPhase: string }>("phase/get", undefined, {
      baseUrl: event.webUrl,
    });
    assert(phase.currentPhase === "lobby", `phase is ${phase.currentPhase}`);
    return "GET / 200, /rpc via proxy 200";
  });

  await step("lobby", STEP_TIMEOUT_MS, async () => {
    await rpc(
      "admin/configure",
      { theme: "Smoke", squadCount: 2, hostedHarnessCount: 1 },
      { admin: true }
    );
    await rpc("people/join", ANA);
    await rpc("people/join", BIA);
    await rpc("squads/join", { personId: ANA.personId, squadId: "squad-1" });
    await rpc("squads/join", { personId: BIA.personId, squadId: "squad-2" });
    return "2 squads, 1 hosted harness, 2 people";
  });

  await step("harnesses online", STEP_TIMEOUT_MS, async () => {
    const home = join(event.temporaryDirectory as string, "home");
    await mkdir(home, { recursive: true });
    supervisor.spawn({
      name: "participant",
      command: [
        "bun",
        "run",
        "dev:cli",
        "--",
        "participant",
        "join",
        `--room=${event.roomCode}`,
        "--participant-id",
        BIA_PARTICIPANT,
        "--nickname",
        BIA.name,
        "--harness",
        "fake",
        "--hub",
        event.hubUrl,
        "--workspace",
        workspacePath(BIA_PARTICIPANT),
        "--no-interactive",
      ],
      // The CLI reads and writes ~/.gambi; a fresh HOME keeps the smoke off
      // the developer's config, as on a clean CI runner.
      env: { GAMBI_NO_INTERACTIVE: "1", HOME: home },
      readyWhen: () => true,
    });
    await waitConnected(HOSTED);
    await waitConnected(BIA_PARTICIPANT);
    await rpc("harnesses/claimHosted", {
      personId: ANA.personId,
      participantId: HOSTED,
    });
    await rpc("phase/advance", undefined, { admin: true });
    return `${HOSTED} claimed, ${BIA_PARTICIPANT} joined via CLI`;
  });

  await step("hosted harness -> valid tile", STEP_TIMEOUT_MS, async () => {
    await steer("squad-1", ANA, HOSTED);
    await prompt("squad-1", ANA, "Construa a praça do bairro");
    const tile = await until(async () => {
      const versions = await rpc<TileVersionView[]>("tiles/versions", {
        squadId: "squad-1",
      });
      return versions.find((version) => version.valid);
    });
    assert(
      tile.sourceParticipantId === HOSTED,
      `tile came from ${tile.sourceParticipantId}`
    );
    assert(
      tile.readme === STARTER_README,
      "the tile README is not the starter README"
    );
    const seeded = join(workspacePath(HOSTED), "index.html");
    assert(
      await exists(seeded),
      `the starter is not in the ephemeral workspace ${seeded}`
    );
    return `board version ${tile.boardVersion} valid, starter README, workspace under gambiHome`;
  });

  await step("byo fake: starter once", STEP_TIMEOUT_MS, async () => {
    await steer("squad-2", BIA, BIA_PARTICIPANT);
    const output = join(workspacePath(BIA_PARTICIPANT), "fake-output.txt");
    await prompt("squad-2", BIA, "Construa a praça do bairro");
    const first = await readNewOutput(output, undefined);
    assert(
      first.includes(STARTER_HEADER) && first.includes("--- README.md ---"),
      "the first prompt did not carry the starter"
    );
    await prompt("squad-2", BIA, SECOND_PROMPT);
    const second = await readNewOutput(output, first);
    assert(
      second.trim() === `Fake ACP response: ${SECOND_PROMPT}`,
      `the second prompt was not passed through unchanged: ${second.slice(0, 120)}`
    );
    return "1st prompt has the starter, 2nd is unchanged";
  });

  await step("orchestrator", STEP_TIMEOUT_MS, async () => {
    await rpc(
      "orchestrator/selectSteerer",
      { actorPersonId: ANA.personId, personId: ANA.personId },
      { admin: true }
    );
    const models = await rpc<{ id: string }[]>("orchestrator/models");
    const ids = models.map((model) => model.id);
    for (const id of ["event-model-a", "event-model-b"]) {
      assert(ids.includes(id), `orchestrator/models lacks ${id}: ${ids}`);
    }
    await rpc("orchestrator/propose", {
      actorPersonId: ANA.personId,
      objective: "Praça coberta no bairro",
    });
    for (let round = 2; round <= 6; round += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: phases advance in order.
      await rpc("phase/advance", undefined, { admin: true });
    }
    await rpc(
      "orchestrator/selectSteerer",
      { actorPersonId: ANA.personId, personId: ANA.personId },
      { admin: true }
    );
    await rpc("orchestrator/swapModel", {
      actorPersonId: ANA.personId,
      participantId: "event-model-b",
    });
    await rpc("orchestrator/propose", {
      actorPersonId: ANA.personId,
      objective: "Ponte entre bairros",
    });
    return `models ${ids.join(", ")}; propose, swapModel, propose 200`;
  });

  await step("hub: open responses", STEP_TIMEOUT_MS, async () => {
    // The hub writes the log block after it answers; give it a moment.
    const blocks = await until(async () => {
      await sleep(POLL_INTERVAL_MS);
      const current = hubLlmBlocks();
      const requests = current.filter((b) => b.kind === "llm.request");
      const completes = current.filter((b) => b.kind === "llm.complete");
      return requests.length >= 2 && completes.length >= requests.length
        ? current
        : undefined;
    });
    const errors = blocks.filter((b) => b.kind === "llm.error");
    assert(errors.length === 0, `the hub logged ${errors.length} llm.error`);
    const requests = blocks.filter((b) => b.kind === "llm.request");
    const other = requests.filter((b) => b.protocol !== "openResponses");
    assert(
      other.length === 0,
      `llm.request with protocol ${other.map((b) => b.protocol)}`
    );
    const completes = blocks.filter((b) => b.kind === "llm.complete").length;
    return `${requests.length} llm.request (openResponses), ${completes} llm.complete, 0 llm.error`;
  });

  await step("workspaces stay ephemeral", STEP_TIMEOUT_MS, async () => {
    const leaked = join(homedir(), ".gambi", "workspaces", event.roomCode);
    assert(!(await exists(leaked)), `${leaked} exists`);
    return `nothing under ~/.gambi/workspaces/${event.roomCode}`;
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

async function portOpen(url: string | undefined) {
  if (!url) {
    return false;
  }
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function cleanup() {
  const pids = supervisor.pids();
  await step(
    "stop and clean up",
    STOP_TIMEOUT_MS,
    async () => {
      await supervisor.stop();
      const alive = pids.filter(groupAlive);
      assert(alive.length === 0, `process groups still alive: ${alive}`);
      const open: string[] = [];
      for (const url of [running?.hubUrl, running?.boardUrl, running?.webUrl]) {
        // biome-ignore lint/performance/noAwaitInLoops: three probes, each bounded.
        if (url && (await portOpen(url))) {
          open.push(url);
        }
      }
      assert(open.length === 0, `still listening: ${open}`);
      const temporary = running?.temporaryDirectory;
      assert(
        !(temporary && (await exists(temporary))),
        `${temporary} was not removed`
      );
      return `${pids.length} process groups gone, ports closed, temp dir removed`;
    },
    false
  );
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

print(`board smoke (total limit ${TOTAL_TIMEOUT_MS / 1000}s)`);
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
