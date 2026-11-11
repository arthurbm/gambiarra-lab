#!/usr/bin/env bun
// The world server as a process. PORT, HOST, GAMBI_HUB_URL, FREVO_ROOM_NAME,
// FREVO_BONECOS, FREVO_DECISION_TIMEOUT_MS, FREVO_PUBLIC_URL, FREVO_WEB_DIST,
// FREVO_ADMIN_SECRET, FREVO_BUDGET_USD, FAL_KEY and FREVO_MUSIC_MAX_GENERATIONS
// configure it. Without FAL_KEY the chosen blocos play the embedded track.
import { randomBytes } from "node:crypto";
import { exists } from "node:fs/promises";
import { resolve } from "node:path";
import { DEFAULT_HUB_URL, DEFAULT_ROOM_NAME } from "../model-host/config";
import { DEFAULT_MAX_GENERATIONS, musicFromKey } from "../music/fal";
import { createMusicFiles } from "../music/files";
import { DEFAULT_RULES } from "../sim/world";
import { startWorldServer } from "./app";

function integer(name: string, fallback: number, minimum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer of at least ${minimum}`);
  }
  return value;
}

const defaultWebDist = resolve(import.meta.dir, "../../../frevo-web/dist");
const webDist =
  process.env.FREVO_WEB_DIST?.trim() ||
  ((await exists(resolve(defaultWebDist, "index.html")))
    ? defaultWebDist
    : undefined);
// `::` takes IPv6 and IPv4; Railway's private network needs IPv6.
const host = process.env.HOST?.trim() || "::";
const givenSecret = process.env.FREVO_ADMIN_SECRET?.trim();
const adminSecret = givenSecret || randomBytes(16).toString("hex");
const budget = process.env.FREVO_BUDGET_USD?.trim();
const ceilingUsd = budget ? Number(budget) : 1;
if (!(Number.isFinite(ceilingUsd) && ceilingUsd >= 0)) {
  throw new Error("FREVO_BUDGET_USD must be a number of dollars");
}

const musicFiles = createMusicFiles();
// The key only reaches fal.ai's Authorization header, never a log.
const music = musicFromKey(process.env.FAL_KEY?.trim() || undefined, {
  files: musicFiles,
  maxGenerations: integer(
    "FREVO_MUSIC_MAX_GENERATIONS",
    DEFAULT_MAX_GENERATIONS,
    0
  ),
  log: (line) => console.log(line),
});

const server = startWorldServer({
  hubUrl: process.env.GAMBI_HUB_URL?.trim() || DEFAULT_HUB_URL,
  roomName: process.env.FREVO_ROOM_NAME?.trim() || DEFAULT_ROOM_NAME,
  host,
  port: integer("PORT", 3200, 0),
  bonecos: integer("FREVO_BONECOS", 1, 0),
  rules: {
    decisionTimeoutMs: integer(
      "FREVO_DECISION_TIMEOUT_MS",
      DEFAULT_RULES.decisionTimeoutMs,
      100
    ),
  },
  webDist,
  adminSecret,
  ceilingUsd,
  publicUrl: process.env.FREVO_PUBLIC_URL?.trim() || undefined,
  music: music.generate,
  musicFiles,
  musicGenerations: music.generations,
  musicTimeoutMs: music.deadlineMs,
  log: (line) => console.log(line),
});

console.log(`Frevo world listening on http://${host}:${server.port}`);
console.log(
  webDist ? `Serving the web from ${webDist}` : "The web is not built"
);
const generations = music.generations();
console.log(
  generations
    ? `Music: generated on fal.ai, up to ${generations.max} generations`
    : "Music: no FAL_KEY, the chosen blocos play the embedded track"
);
if (!givenSecret) {
  // Only when the secret was drawn here: a configured one never reaches a log.
  console.log(
    `Admin (no FREVO_ADMIN_SECRET, drawn for this run): /admin?k=${adminSecret}`
  );
}

let stopping = false;
async function shutdown() {
  if (stopping) {
    return;
  }
  stopping = true;
  await server.stop();
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
