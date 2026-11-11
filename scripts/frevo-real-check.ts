#!/usr/bin/env bun
// The reliability battery through a real hub: starts a hub on a free port,
// joins one participant per model behind the provider proxy (the key and each
// model's request fields stay there), and asks each model for `--n` decisions
// the way the world server does. Only the first answer counts: the battery
// measures the model, not the scheduler's repeat. Exits 0 when every model
// returned a valid tool call in at least 9 of 10 attempts.
//
//   bun run frevo:real-check [--n 10] [model ...]
//
// The key comes from OPENROUTER_API_KEY or ~/.config/gambiarra-lab/openrouter.key.
// FREVO_REAL_CHECK_BUDGET_USD (default 0.10) stops the battery when the
// providers' reported cost reaches it.
import { decisionBody, readDecision } from "../apps/frevo/src/brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../apps/frevo/src/gambi/room";
import { modelHostConfig } from "../apps/frevo/src/model-host/config";
import { startModelHost } from "../apps/frevo/src/model-host/host";
import { startProviderProxy } from "../apps/frevo/src/model-host/provider-proxy";
import {
  DEFAULT_REAL_MODELS,
  parseModels,
} from "../apps/frevo/src/models/catalog";
import { PRACA } from "../apps/frevo/src/sim/world";
import { startHub } from "../apps/frevo/src/testing/processes";
import { until } from "../apps/frevo/src/testing/until";

const ROOM_NAME = "frevo-real-check";
const PASS_SHARE = 0.9;
const NAMES = ["Capiba", "Lia", "Naná", "Chico", "Alceu"];

const args = process.argv.slice(2);
const nIndex = args.indexOf("--n");
const attempts = nIndex >= 0 ? Number(args[nIndex + 1]) : 10;
const named = args.filter(
  (arg, index) => arg !== "--n" && !(nIndex >= 0 && index === nIndex + 1)
);
const models =
  named.length > 0
    ? named
    : parseModels(DEFAULT_REAL_MODELS).map((spec) => spec.model);
const budgetUsd = Number(process.env.FREVO_REAL_CHECK_BUDGET_USD || 0.1);

const config = await modelHostConfig({
  ...process.env,
  FREVO_MODEL_HOST_MODE: "openrouter",
  FREVO_MODELS: models.join(","),
});
if (config.mode !== "openrouter") {
  throw new Error("the real check needs the real provider");
}

interface Attempt {
  costUsd: number;
  ms: number;
  reason?: string;
  speech?: string;
  status: number;
}

let spentUsd = 0;
const results = new Map<string, Attempt[]>();

function percentile(values: number[], share: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(share * sorted.length))];
}

const hub = await startHub();
const proxy = startProviderProxy({ models, upstream: config.upstream });
let failed = false;
try {
  const room = await ensureRoom(hub.url, ROOM_NAME);
  const host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: config.models.map((spec) => ({ ...spec, participants: 1 })),
    upstream: { endpoint: proxy.endpoint },
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
    const infer = roomInference(hub.url, () => room.code);
    // One participant per model, so each model asks one at a time; the
    // models run side by side.
    await Promise.all(
      participants.map(async (participant) => {
        const done: Attempt[] = [];
        results.set(participant.model, done);
        for (let index = 0; index < attempts; index += 1) {
          if (spentUsd >= budgetUsd) {
            return;
          }
          const place = PRACA.places[index % PRACA.places.length];
          const request = {
            id: `check#${index}`,
            boneco: {
              id: "boneco-1",
              name: NAMES[index % NAMES.length] as string,
            },
            deadlineMs: 30_000,
            placeId: place?.id ?? null,
            places: PRACA.places,
          };
          const body = decisionBody(request, participant.id);
          const startedAt = performance.now();
          try {
            // biome-ignore lint/performance/noAwaitInLoops: one call at a time per participant, as the hub allows.
            const completion = await infer(
              participant.id,
              body,
              AbortSignal.timeout(60_000)
            );
            const costUsd = Number(
              (completion as { usage?: { cost?: unknown } }).usage?.cost ?? 0
            );
            spentUsd += Number.isFinite(costUsd) ? costUsd : 0;
            const read = readDecision(completion, body);
            done.push({
              status: 200,
              ms: performance.now() - startedAt,
              costUsd,
              speech: read.ok ? read.action.speech : undefined,
              reason: read.ok ? undefined : read.reason,
            });
          } catch (error) {
            done.push({
              status: (error as { status?: number }).status ?? 0,
              ms: performance.now() - startedAt,
              costUsd: 0,
              reason: error instanceof Error ? error.message : String(error),
            });
          }
        }
      })
    );
  } finally {
    await host.stop();
  }
} catch (error) {
  failed = true;
  console.log(
    `FAIL  ${error instanceof Error ? error.message : String(error)}`
  );
} finally {
  proxy.stop();
  await hub.stop();
}

for (const model of models) {
  const done = results.get(model) ?? [];
  const valid = done.filter((attempt) => attempt.speech !== undefined);
  const ms = done.map((attempt) => attempt.ms);
  const cost = done.reduce((sum, attempt) => sum + attempt.costUsd, 0);
  const passed =
    done.length === attempts && valid.length >= attempts * PASS_SHARE;
  failed ||= !passed;
  console.log(
    `${passed ? "ok  " : "FAIL"}  ${model}: ${valid.length}/${done.length} valid, p50 ${Math.round(percentile(ms, 0.5) ?? 0)}ms, p95 ${Math.round(percentile(ms, 0.95) ?? 0)}ms, US$ ${cost.toFixed(5)}`
  );
  for (const attempt of done.filter((entry) => entry.reason)) {
    console.log(`        ${attempt.status}: ${attempt.reason?.slice(0, 160)}`);
  }
  for (const attempt of valid.slice(0, 2)) {
    console.log(`        "${attempt.speech}"`);
  }
}
console.log(`spent US$ ${spentUsd.toFixed(5)} (budget US$ ${budgetUsd})`);
process.exit(failed ? 1 : 0);
