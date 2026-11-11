#!/usr/bin/env bun
// The model host as a process. FREVO_MODEL_HOST_MODE=fake answers with a
// local deterministic model; the default points at OpenRouter.
// FREVO_MODEL_HOST_PORT is where GET /health answers (0 or unset: a free
// port). It is not PORT, which the world uses when both run from one shell.
import { modelHostConfig } from "./config";
import { type FakeUpstream, startFakeUpstream } from "./fake-upstream";
import { serveModelHostHealth } from "./health";
import { startModelHost } from "./host";

const config = await modelHostConfig();
const fake =
  config.mode === "fake"
    ? startFakeUpstream({
        models: config.models.map((spec) => spec.model),
        latencyMs: Number(process.env.FREVO_FAKE_LATENCY_MS || 600),
      })
    : undefined;
const upstream =
  config.mode === "fake"
    ? { endpoint: (fake as FakeUpstream).endpoint }
    : config.upstream;

const host = startModelHost({
  hubUrl: config.hubUrl,
  roomName: config.roomName,
  models: config.models,
  upstream,
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
  fake?.stop();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
