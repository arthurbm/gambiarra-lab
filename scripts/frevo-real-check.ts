#!/usr/bin/env bun
// One real decision through the hub: starts a hub on a free port, joins one
// model participant that points at OpenRouter, and asks it for a forced tool
// call the way the world server does. Exits 0 when an action came back.
//
//   bun run frevo:real-check [model ...]
//
// The key comes from OPENROUTER_API_KEY or ~/.config/gambiarra-lab/openrouter.key.
// Each model costs one short completion (max_tokens 200).
import { createBrainScheduler } from "../apps/frevo/src/brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../apps/frevo/src/gambi/room";
import { modelHostConfig } from "../apps/frevo/src/model-host/config";
import { startModelHost } from "../apps/frevo/src/model-host/host";
import { PRACA } from "../apps/frevo/src/sim/world";
import { startHub } from "../apps/frevo/src/testing/processes";
import { until } from "../apps/frevo/src/testing/until";

const ROOM_NAME = "frevo-real-check";
const models = process.argv.slice(2);

const config = await modelHostConfig({
  ...process.env,
  FREVO_MODEL_HOST_MODE: "openrouter",
  FREVO_MODELS: (models.length > 0
    ? models
    : ["anthropic/claude-haiku-5.5"]
  ).join(","),
});
if (config.mode !== "openrouter") {
  throw new Error("the real check needs the real provider");
}

const hub = await startHub();
let failed = false;
try {
  const room = await ensureRoom(hub.url, ROOM_NAME);
  const host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: config.models.map((spec) => ({ ...spec, participants: 1 })),
    upstream: config.upstream,
    retryMs: 1000,
    onEvent: (event) => {
      if (event.type === "retrying") {
        console.log(`  ${event.participantId}: ${event.error}`);
      }
    },
  });
  try {
    const participants = await until(async () => {
      const connected = await listModelParticipants(hub.url, room.code);
      return connected.length === host.participantIds.length
        ? connected
        : undefined;
    }, 60_000);
    for (const participant of participants) {
      const scheduler = createBrainScheduler({
        infer: roomInference(hub.url, () => room.code),
        requestTimeoutMs: 30_000,
      });
      scheduler.setParticipants([participant]);
      const startedAt = performance.now();
      scheduler.submit({
        id: `check#${participant.id}`,
        boneco: { id: "boneco-1", name: "Capiba" },
        deadlineMs: 30_000,
        placeId: "marco-zero",
        places: PRACA.places,
      });
      // biome-ignore lint/performance/noAwaitInLoops: one model at a time keeps the output readable.
      const result = await until(
        () => Promise.resolve(scheduler.drain()[0]),
        40_000
      );
      const took = `${Math.round(performance.now() - startedAt)}ms`;
      if (result.ok && result.action.type === "walk") {
        console.log(
          `ok    ${participant.model} (${took}): ${result.action.placeId} — "${result.action.speech}"`
        );
      } else {
        failed = true;
        const reason = result.ok ? "not a walk" : result.reason;
        console.log(`FAIL  ${participant.model} (${took}): ${reason}`);
      }
    }
  } finally {
    await host.stop();
  }
} catch (error) {
  failed = true;
  console.log(
    `FAIL  ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  await hub.stop();
}
process.exit(failed ? 1 : 0);
