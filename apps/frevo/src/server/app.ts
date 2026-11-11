// The world server: runs the simulation on a fixed clock, asks the Room's
// models for the bonecos' decisions and publishes the world over SSE. It also
// serves the built web, so the experience is one public service.
import { resolve, sep } from "node:path";
import { createBrainScheduler } from "../brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../gambi/room";
import {
  type BrainResult,
  createWorld,
  DEFAULT_RULES,
  publicSnapshot,
  step,
  type WorldRules,
} from "../sim/world";

export interface WorldServerOptions {
  /** Simulated bonecos in the square. */
  bonecos?: number;
  host?: string;
  hubUrl: string;
  log?: (line: string) => void;
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
    rules,
  });
  let roomCode: string | null = null;
  let participantCount = 0;
  let stopped = false;

  const scheduler = createBrainScheduler({
    infer: roomInference(options.hubUrl, () => roomCode ?? ""),
    requestTimeoutMs: rules.decisionTimeoutMs,
  });

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

  /** Each open telão and the way it leaves. */
  const telao = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    () => void
  >();

  // The deploy stays up all day. With no stream open (telão, phone or admin)
  // nobody can see a decision, so none goes to a paid model: the bonecos walk
  // on autopilot until someone connects. Every SSE route calls `watch`.
  let viewers = 0;
  function watch(): () => void {
    viewers += 1;
    if (viewers === 1) {
      log("Someone is watching: the bonecos ask the Room's models");
    }
    let left = false;
    return () => {
      if (left) {
        return;
      }
      left = true;
      viewers -= 1;
      if (viewers === 0) {
        log("Nobody is watching: the bonecos walk on autopilot");
      }
    };
  }
  /** Answers for requests nobody asked a model about; fed to the next step. */
  let unwatched: BrainResult[] = [];

  function broadcast(chunk: Uint8Array) {
    for (const [controller, leave] of telao) {
      try {
        controller.enqueue(chunk);
      } catch {
        leave();
      }
    }
  }

  const tickTimer = setInterval(() => {
    const next = step(world, {
      elapsedMs: tickMs,
      results: [...unwatched, ...scheduler.drain()],
    });
    ({ world } = next);
    unwatched = [];
    for (const request of next.requests) {
      if (viewers > 0) {
        scheduler.submit(request);
      } else {
        unwatched.push({
          ok: false,
          requestId: request.id,
          reason: "nobody is watching",
        });
      }
    }
  }, tickMs);
  const publishTimer = setInterval(
    () => broadcast(sseEvent("snapshot", publicSnapshot(world))),
    options.publishMs ?? 200
  );
  const keepaliveTimer = setInterval(
    () => broadcast(encoder.encode(": keepalive\n\n")),
    KEEPALIVE_MS
  );

  function telaoStream(request: Request): Response {
    let self: ReadableStreamDefaultController<Uint8Array> | undefined;
    const unwatch = watch();
    const leave = () => {
      unwatch();
      if (self) {
        telao.delete(self);
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        controller.enqueue(encoder.encode(`retry: ${SSE_RETRY_MS}\n\n`));
        controller.enqueue(sseEvent("snapshot", publicSnapshot(world)));
        telao.set(controller, leave);
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

  const server = Bun.serve({
    // `::` takes IPv6 and IPv4; Railway's private network needs IPv6.
    hostname: options.host ?? "::",
    port: options.port ?? 0,
    fetch(request, bunServer) {
      const { pathname } = new URL(request.url);
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405 });
      }
      if (pathname === "/health") {
        return Response.json({
          ok: true,
          room: roomCode,
          participants: participantCount,
          bonecos: world.bonecos.length,
          viewers,
        });
      }
      if (pathname === "/events/telao") {
        // The stream stays open; Bun's idle timeout must not close it.
        bunServer.timeout(request, 0);
        return telaoStream(request);
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
      for (const controller of telao.keys()) {
        try {
          controller.close();
        } catch {
          // The telão already left.
        }
      }
      telao.clear();
      await server.stop(true);
      await refreshing;
    },
  };
}
