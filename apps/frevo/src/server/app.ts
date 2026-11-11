// The world server: runs the simulation on a fixed clock, asks the Room's
// models for the bonecos' decisions and publishes the world over SSE. It also
// serves the built web, so the experience is one public service.

import { timingSafeEqual } from "node:crypto";
import { resolve, sep } from "node:path";
import { createModelMetrics } from "../brains/metrics";
import { createBrainScheduler } from "../brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../gambi/room";
import { watchRoomLlmEvents } from "../gambi/room-events";
import { modelEntry, modelLabel } from "../models/catalog";
import { modelPanelRows } from "../models/panel";
import {
  createWorld,
  DEFAULT_RULES,
  publicSnapshot,
  step,
  type WorldRules,
} from "../sim/world";

export interface WorldServerOptions {
  /** `Authorization: Bearer <secret>` opens /api/admin/*; without it they stay closed. */
  adminSecret?: string;
  /** Simulated bonecos in the square. */
  bonecos?: number;
  /** Estimated session spending after which every boneco goes on autopilot. */
  ceilingUsd?: number;
  /** How long a decision waits for its boneco's model before any model takes it. */
  fallbackMs?: number;
  host?: string;
  hubUrl: string;
  log?: (line: string) => void;
  /** Models given in turns to the simulated bonecos. */
  models?: string[];
  /** 0 asks the OS for a free port. */
  port?: number;
  /** How often the telão gets the world. */
  publishMs?: number;
  /** The Room is created, or reused, under this name. */
  roomName: string;
  /** How often the Room and its model participants are checked. */
  roomRefreshMs?: number;
  rules?: Partial<WorldRules>;
  seed?: number;
  /** The simulation's fixed step. */
  tickMs?: number;
  /** Directory with the built web; without it only the API is served. */
  webDist?: string;
}

export interface WorldServer {
  port: number;
  stop: () => Promise<void>;
  url: string;
}

// Railway closes a connection that is idle for five minutes; the stream is
// never quiet for longer than this even when the world stops publishing.
const KEEPALIVE_MS = 15_000;
/** How long the browser waits before connecting again. */
const SSE_RETRY_MS = 1000;
const encoder = new TextEncoder();

function sseEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function startWorldServer(options: WorldServerOptions): WorldServer {
  const log = options.log ?? (() => undefined);
  const tickMs = options.tickMs ?? 100;
  const rules = { ...DEFAULT_RULES, ...options.rules };
  const webDist = options.webDist ? resolve(options.webDist) : undefined;

  let world = createWorld({
    seed: options.seed ?? Date.now(),
    bonecos: options.bonecos ?? 1,
    models: options.models,
    rules,
  });
  let roomCode: string | null = null;
  let participantCount = 0;
  let stopped = false;

  const metrics = createModelMetrics({
    price: (model) => modelEntry(model).price,
  });
  const scheduler = createBrainScheduler({
    infer: roomInference(options.hubUrl, () => roomCode ?? ""),
    requestTimeoutMs: rules.decisionTimeoutMs,
    ceilingUsd: options.ceilingUsd ?? 1,
    fallbackMs: options.fallbackMs,
    metrics,
  });
  // The panel's numbers come from the Room's inference events.
  const roomEvents = watchRoomLlmEvents({
    hubUrl: options.hubUrl,
    roomCode: () => roomCode,
    onEvent: metrics.observe,
    onOpen: metrics.streamOpened,
  });
  let warnedCeiling = false;

  function modelRows() {
    return modelPanelRows({
      available: scheduler.models(),
      stats: metrics.stats(),
    });
  }

  function telaoSnapshot() {
    const budget = scheduler.budget();
    if (budget.exceeded && !warnedCeiling) {
      log(
        `Spending ceiling reached (US$ ${budget.spentUsd.toFixed(4)} of ${budget.ceilingUsd}): every boneco is on autopilot`
      );
    }
    warnedCeiling = budget.exceeded;
    return {
      ...publicSnapshot(world),
      models: modelRows().map(({ fromEvents: _, ...row }) => row),
    };
  }

  // The Room: created or reused by name, and looked up again whenever the hub
  // stops knowing it, which is what a hub restart looks like from here.
  async function refreshRoom() {
    try {
      if (!roomCode) {
        const room = await ensureRoom(options.hubUrl, options.roomName);
        roomCode = room.code;
        log(
          `Room ${room.code} ${room.created ? "created" : "reused"} for "${options.roomName}"`
        );
      }
      const participants = await listModelParticipants(
        options.hubUrl,
        roomCode
      );
      if (participants.length !== participantCount) {
        log(`${participants.length} model participant(s) in the Room`);
      }
      participantCount = participants.length;
      scheduler.setParticipants(participants);
    } catch (error) {
      if (roomCode) {
        log(
          `Lost the Room ${roomCode}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      roomCode = null;
      participantCount = 0;
      scheduler.setParticipants([]);
    }
  }

  let refreshing: Promise<void> = Promise.resolve();
  const roomTimer = setInterval(() => {
    refreshing = refreshing.then(() => (stopped ? undefined : refreshRoom()));
  }, options.roomRefreshMs ?? 2000);
  refreshing = refreshRoom();

  const telao = new Set<ReadableStreamDefaultController<Uint8Array>>();

  function broadcast(chunk: Uint8Array) {
    for (const controller of telao) {
      try {
        controller.enqueue(chunk);
      } catch {
        telao.delete(controller);
      }
    }
  }

  const tickTimer = setInterval(() => {
    const next = step(world, {
      elapsedMs: tickMs,
      results: scheduler.drain(),
    });
    ({ world } = next);
    for (const request of next.requests) {
      scheduler.submit(request);
    }
  }, tickMs);
  const publishTimer = setInterval(
    () => broadcast(sseEvent("snapshot", telaoSnapshot())),
    options.publishMs ?? 200
  );
  const keepaliveTimer = setInterval(
    () => broadcast(encoder.encode(": keepalive\n\n")),
    KEEPALIVE_MS
  );

  function telaoStream(request: Request): Response {
    let self: ReadableStreamDefaultController<Uint8Array> | undefined;
    const leave = () => {
      if (self) {
        telao.delete(self);
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        controller.enqueue(encoder.encode(`retry: ${SSE_RETRY_MS}\n\n`));
        controller.enqueue(sseEvent("snapshot", telaoSnapshot()));
        telao.add(controller);
      },
      cancel: leave,
    });
    request.signal.addEventListener("abort", leave);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }

  async function staticFile(pathname: string): Promise<Response> {
    if (!webDist) {
      return new Response(
        "The web is not built. Run `bun run --cwd apps/frevo-web build`, or use the Vite dev server.",
        { status: 404 }
      );
    }
    let relative = "";
    try {
      relative = decodeURIComponent(pathname);
    } catch {
      // Not a path we can serve; the page answers instead.
    }
    const candidate = resolve(webDist, `.${sep}${relative}`);
    const inside = candidate.startsWith(`${webDist}${sep}`);
    const file = Bun.file(candidate);
    if (inside && (await file.exists())) {
      return new Response(file);
    }
    // Every route of the web is the same page.
    return new Response(Bun.file(resolve(webDist, "index.html")), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  function adminAllowed(request: Request) {
    const secret = options.adminSecret;
    const given = request.headers.get("authorization") ?? "";
    const expected = `Bearer ${secret}`;
    return (
      Boolean(secret) &&
      given.length === expected.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(expected))
    );
  }

  function adminState() {
    return Response.json({
      models: modelRows(),
      spending: scheduler.budget(),
    });
  }

  async function adminApi(request: Request, pathname: string) {
    if (!adminAllowed(request)) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    if (pathname === "/api/admin/models" && request.method === "GET") {
      return adminState();
    }
    if (pathname === "/api/admin/models" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as {
        enabled?: unknown;
        model?: unknown;
      };
      if (typeof body.model !== "string" || typeof body.enabled !== "boolean") {
        return Response.json(
          { error: "send { model: string, enabled: boolean }" },
          { status: 400 }
        );
      }
      scheduler.setModelEnabled(body.model, body.enabled);
      log(`Model ${body.model} switched ${body.enabled ? "on" : "off"}`);
      return adminState();
    }
    if (pathname === "/api/admin/spending/reset" && request.method === "POST") {
      scheduler.resetBudget();
      log("Spending reset to zero");
      return adminState();
    }
    return Response.json({ error: "not found" }, { status: 404 });
  }

  function publicModels() {
    return Response.json({
      models: scheduler.models().map((entry) => ({
        model: entry.model,
        label: modelLabel(entry.model),
        participants: entry.participants,
        enabled: entry.enabled,
      })),
    });
  }

  const server = Bun.serve({
    hostname: options.host ?? "0.0.0.0",
    port: options.port ?? 0,
    fetch(request, bunServer) {
      const { pathname } = new URL(request.url);
      if (pathname.startsWith("/api/admin/")) {
        return adminApi(request, pathname);
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (pathname === "/health") {
        return Response.json({
          ok: true,
          room: roomCode,
          participants: participantCount,
          bonecos: world.bonecos.length,
        });
      }
      if (pathname === "/events/telao") {
        // The stream stays open; Bun's idle timeout must not close it.
        bunServer.timeout(request, 0);
        return telaoStream(request);
      }
      if (pathname === "/api/models") {
        return publicModels();
      }
      if (pathname.startsWith("/events/") || pathname.startsWith("/api/")) {
        return new Response("Not Found", { status: 404 });
      }
      return staticFile(pathname);
    },
  });

  const port = server.port as number;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    async stop() {
      stopped = true;
      for (const timer of [
        roomTimer,
        tickTimer,
        publishTimer,
        keepaliveTimer,
      ]) {
        clearInterval(timer);
      }
      for (const controller of telao) {
        try {
          controller.close();
        } catch {
          // The telão already left.
        }
      }
      telao.clear();
      await roomEvents.stop();
      await server.stop(true);
      await refreshing;
    },
  };
}
