#!/usr/bin/env bun
// The model host as a process. FREVO_MODEL_HOST_MODE=fake answers with a
// local deterministic model; the default points at OpenRouter.
import { modelHostConfig } from "./config";
import { type FakeUpstream, startFakeUpstream } from "./fake-upstream";
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

console.log(
  `Frevo model host started: ${host.participantIds.length} participant(s), mode ${config.mode}, Room "${config.roomName}" on ${config.hubUrl}`
);

let stopping = false;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  await host.stop();
  fake?.stop();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
