// The scheduler against a real hub: twelve fake participants on five models
// and 25 bonecos deciding at once. The hub refuses a busy participant with 409
// (and a missing one with 404); neither may happen.
import { afterAll, beforeAll, expect, test } from "bun:test";
import {
  ensureRoom,
  HubError,
  listModelParticipants,
  roomInference,
} from "../gambi/room";
import { watchRoomLlmEvents } from "../gambi/room-events";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import {
  DEFAULT_FAKE_MODELS,
  modelEntry,
  parseModels,
} from "../models/catalog";
import { PRACA } from "../sim/world";
import { type RunningHub, startHub } from "../testing/processes";
import { until } from "../testing/until";
import { createModelMetrics } from "./metrics";
import { createBrainScheduler, type Inference } from "./scheduler";

const ROOM_NAME = "frevo-25-bonecos";
const BONECOS = 25;
const RUN_MS = 10_000;
const SPECS = parseModels(DEFAULT_FAKE_MODELS);
const MODELS = SPECS.map((spec) => spec.model);

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let roomCode = "";

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({
    models: MODELS,
    // The stage's latencies, shrunk so the test sees many rounds.
    profiles: Object.fromEntries(
      MODELS.map((model) => {
        const profile = modelEntry(model).fake;
        const [low, high] = profile?.latencyMs ?? [0, 0];
        return [
          model,
          profile && { ...profile, latencyMs: [low / 4, high / 4] },
        ];
      })
    ),
  });
  roomCode = (await ensureRoom(hub.url, ROOM_NAME)).code;
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: SPECS,
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
});

afterAll(async () => {
  await host.stop();
  upstream.stop();
  await hub.stop();
});

test("25 bonecos decide through twelve participants without a single busy refusal", async () => {
  const participants = await until(async () => {
    const connected = await listModelParticipants(hub.url, roomCode);
    return connected.length === 12 ? connected : undefined;
  }, 30_000);

  const statuses = new Map<number, number>();
  const room = roomInference(hub.url, () => roomCode);
  const infer: Inference = async (participantId, body, signal) => {
    try {
      const answer = await room(participantId, body, signal);
      statuses.set(200, (statuses.get(200) ?? 0) + 1);
      return answer;
    } catch (error) {
      const status = error instanceof HubError ? error.status : 0;
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
      throw error;
    }
  };
  const metrics = createModelMetrics({
    price: (model) => modelEntry(model).price,
  });
  const scheduler = createBrainScheduler({
    infer,
    metrics,
    fallbackMs: 300,
    requestTimeoutMs: 8000,
  });
  scheduler.setParticipants(participants);
  const watch = watchRoomLlmEvents({
    hubUrl: hub.url,
    roomCode: () => roomCode,
    onEvent: metrics.observe,
    onOpen: metrics.streamOpened,
    retryMs: 100,
  });
  // The world refreshes the Room's participants every two seconds; so does this.
  const refresh = setInterval(async () => {
    scheduler.setParticipants(await listModelParticipants(hub.url, roomCode));
  }, 2000);

  const startedAt = Date.now();
  let ok = 0;
  let failed = 0;
  const waiting = new Map<string, number>();
  let sequence = 0;
  function ask(boneco: number) {
    sequence += 1;
    const id = `boneco-${boneco}#${sequence}`;
    waiting.set(id, boneco);
    scheduler.submit({
      id,
      boneco: { id: `boneco-${boneco}`, name: "Capiba" },
      deadlineMs: 0,
      model: MODELS[boneco % MODELS.length] as string,
      placeId: null,
      places: PRACA.places,
    });
  }
  for (let boneco = 1; boneco <= BONECOS; boneco += 1) {
    ask(boneco);
  }
  try {
    while (Date.now() - startedAt < RUN_MS || waiting.size > 0) {
      for (const result of scheduler.drain()) {
        if (result.ok) {
          ok += 1;
        } else {
          failed += 1;
        }
        const boneco = waiting.get(result.requestId) as number;
        waiting.delete(result.requestId);
        if (Date.now() - startedAt < RUN_MS) {
          ask(boneco);
        }
      }
      // biome-ignore lint/performance/noAwaitInLoops: the bonecos ask again as their answers arrive.
      await Bun.sleep(20);
    }
    // Let the last events arrive.
    await Bun.sleep(300);
  } finally {
    clearInterval(refresh);
    await watch.stop();
  }

  const stats = metrics.stats();
  console.log(
    `${ok} decisions, ${failed} on autopilot, hub statuses ${JSON.stringify(Object.fromEntries(statuses))}`
  );
  for (const row of stats) {
    console.log(
      `  ${row.model}: ${row.decisions} decisions, ${row.failures} failures, ${row.avgMs}ms, ${row.fromEvents} from events`
    );
  }
  expect(statuses.get(409) ?? 0).toBe(0);
  expect(statuses.get(404) ?? 0).toBe(0);
  expect(ok).toBeGreaterThan(BONECOS * 5);
  // Every model answered, and the panel's numbers came from the hub's events.
  expect(stats.map((row) => row.model).sort()).toEqual([...MODELS].sort());
  const decisions = stats.reduce((sum, row) => sum + row.decisions, 0);
  expect(decisions).toBe(ok);
  const fromEvents = stats.reduce((sum, row) => sum + row.fromEvents, 0);
  const calls = stats.reduce(
    (sum, row) => sum + row.decisions + row.failures,
    0
  );
  expect(fromEvents).toBeGreaterThan(calls * 0.9);
}, 60_000);
