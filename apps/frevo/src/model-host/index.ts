#!/usr/bin/env bun
// The model host as a process. FREVO_MODEL_HOST_MODE=fake answers with local
// fake models (FREVO_FAKE_LATENCY_MS fixes their latency, FREVO_FAKE_FAILURES=0
// turns their failures off); the default points at OpenRouter through the
// provider proxy, which holds the key and each model's request fields.
// FREVO_MODEL_HOST_PORT is where GET /health answers (0 or unset: a free
// port). It is not PORT, which the world uses when both run from one shell.
import { modelEntry } from "../models/catalog";
import { modelHostConfig } from "./config";
import { startFakeUpstream } from "./fake-upstream";
import { serveModelHostHealth } from "./health";
import { startModelHost } from "./host";
import { startProviderProxy } from "./provider-proxy";

const config = await modelHostConfig();
const models = config.models.map((spec) => spec.model);
const latency = process.env.FREVO_FAKE_LATENCY_MS?.trim();
const failures = process.env.FREVO_FAKE_FAILURES?.trim() !== "0";
const local =
  config.mode === "fake"
    ? startFakeUpstream({
        models,
        latencyMs: latency ? Number(latency) : undefined,
        profiles: Object.fromEntries(
          models.map((model) => {
            const profile = modelEntry(model).fake;
            return [
              model,
              profile && !failures
                ? { ...profile, errorRate: 0, invalidRate: 0 }
                : profile,
            ];
          })
        ),
      })
    : startProviderProxy({ models, upstream: config.upstream });

const host = startModelHost({
  hubUrl: config.hubUrl,
  roomName: config.roomName,
  models: config.models,
  upstream: { endpoint: local.endpoint },
  onEvent: (event) => console.log(JSON.stringify(event)),
});

const healthPort = Number(process.env.FREVO_MODEL_HOST_PORT?.trim() || 0);
if (!Number.isInteger(healthPort) || healthPort < 0) {
  throw new Error("FREVO_MODEL_HOST_PORT must be a port number");
}
const health = serveModelHostHealth(host, {
  host: process.env.HOST?.trim() || "::",
  port: healthPort,
});

console.log(
  `Frevo model host started: ${host.participantIds.length} participant(s), mode ${config.mode}, Room "${config.roomName}" on ${config.hubUrl}; health on port ${health.port}`
);

let stopping = false;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  await health.stop();
  await host.stop();
  local.stop();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
