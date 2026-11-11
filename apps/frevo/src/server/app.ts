// The world server: runs the simulation on a fixed clock, asks the Room's
// models for the bonecos' decisions and publishes the world over SSE. It also
// serves the built web, so the experience is one public service.

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
import { MUSIC_PATH, type MusicFiles } from "../music/files";
import type { MusicGenerations, MusicGenerator } from "../music/generator";
import { createJukebox } from "../music/jukebox";
import { leave as leaveSquare } from "../sim/admin";
import { tick } from "../sim/phases";
import {
  acceptPersonName,
  answerHuman,
  type BrainResult,
  createWorld,
  DEFAULT_RULES,
  type HumanAnswer,
  isLook,
  join,
  LOOKS,
  looksInUse,
  privateView,
  squareFull,
  type World,
  type WorldRules,
} from "../sim/world";
import { createAdminApi } from "./admin";
import { createSimulatedHumans } from "./simulated";
import { sseHeaders } from "./sse";
import {
  type PhoneEvent,
  phoneView,
  type TelaoAudio,
  telaoSnapshot as withPhaseClock,
} from "./views";

export interface WorldServerOptions {
  /** `Authorization: Bearer <secret>` opens /api/admin/*; without it they stay closed. */
  adminSecret?: string;
  /** Bonecos with no person behind them, walking on their own; 0 by default. */
  bonecos?: number;
  /** Estimated session spending after which every boneco goes on autopilot. */
  ceilingUsd?: number;
  /** How long a decision waits for its boneco's model before any model takes it. */
  fallbackMs?: number;
  host?: string;
  hubUrl: string;
  log?: (line: string) => void;
  /** Makes the music of a chosen bloco; the default answers with the embedded track. */
  music?: MusicGenerator;
  /** The generated music's copies, served at their paths under /api/musica/. */
  musicFiles?: MusicFiles;
  /** Generations used and allowed, for the admin; null when generation is off. */
  musicGenerations?: () => MusicGenerations;
  /** Music not ready after this long becomes the embedded track. */
  musicTimeoutMs?: number;
  /** 0 asks the OS for a free port. */
  port?: number;
  /** The address people open from the QR; the telão falls back to its own. */
  publicUrl?: string;
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
/** How long a call to the API counts as someone watching. */
const API_ACTIVITY_MS = 5000;
/** How long the browser waits before connecting again. */
const SSE_RETRY_MS = 1000;
const encoder = new TextEncoder();
/** A session id from the phone: opaque, short, URL safe. */
const SESSION_ID = /^[A-Za-z0-9_-]{8,64}$/;
/** How often the admin gets the host's state. */
const ADMIN_PUBLISH_MS = 500;

async function jsonBody(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

/**
 * The name and look a new person asked for; null lets the world draw one. A
 * name the filter refuses is a 422 `nomeRecusado`. A look that is not one of
 * the art is a 400; one a boneco on the square already wears is a 409
 * `visualOcupado`, unless the square is full, which answers `lotado` instead.
 */
function newcomerChoices(
  world: World,
  body: Record<string, unknown>
): { look: number | null; name: string | null } | { refused: Response } {
  const asked = typeof body.nome === "string" ? body.nome.trim() : "";
  const name = asked ? acceptPersonName(asked) : null;
  if (asked && !name) {
    return {
      refused: Response.json(
        {
          ok: false,
          nomeRecusado: true,
          erro: "Esse nome não pode ir para o telão. Tente outro.",
        },
        { status: 422 }
      ),
    };
  }
  const value = body.look;
  if (value === undefined || value === null) {
    return { name, look: null };
  }
  if (!isLook(value)) {
    return {
      refused: Response.json(
        {
          ok: false,
          erro: `O visual precisa ser um número inteiro de 0 a ${LOOKS - 1}.`,
        },
        { status: 400 }
      ),
    };
  }
  if (!squareFull(world) && looksInUse(world).includes(value)) {
    return {
      refused: Response.json(
        {
          ok: false,
          visualOcupado: true,
          erro: "Esse boneco já está na praça. Escolha outro.",
        },
        { status: 409 }
      ),
    };
  }
  return { name, look: value };
}

function sessionOf(value: unknown): string {
  if (typeof value !== "string" || !SESSION_ID.test(value)) {
    throw new Response("Sessão inválida.", { status: 400 });
  }
  return value;
}

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
    bonecos: options.bonecos ?? 0,
    rules,
  });
  let roomCode: string | null = null;
  let participantCount = 0;
  let models: string[] = [];
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
  const jukebox = createJukebox({
    generator: options.music,
    timeoutMs: options.musicTimeoutMs,
    log,
  });

  function telaoAudio(): TelaoAudio | null {
    const command = jukebox.current();
    return command ? { ...command, ageMs: Date.now() - command.atMs } : null;
  }

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
      ...withPhaseClock(world),
      audio: telaoAudio(),
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
      // New bonecos are spread over the models that are switched on.
      models = scheduler
        .models()
        .filter((entry) => entry.enabled)
        .map((entry) => entry.model);
    } catch (error) {
      if (roomCode) {
        log(
          `Lost the Room ${roomCode}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      roomCode = null;
      participantCount = 0;
      models = [];
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
  // A phone posts `entrar` and opens its stream a moment later; a request in
  // between (its first question) must still go to a model.
  let activeUntil = 0;
  const watched = () => viewers > 0 || Date.now() < activeUntil;
  /** Each phone's streams, by session: one person may have two tabs open. */
  const phones = new Map<
    string,
    Map<ReadableStreamDefaultController<Uint8Array>, () => void>
  >();
  /** Sessions the host expelled; they stay out until the admin restarts. */
  const expelled = new Set<string>();
  /**
   * Sessions whose person left from the phone. Their other tabs are told so
   * instead of entering again; entering with one gives a new boneco.
   */
  const left = new Set<string>();
  const simulated = createSimulatedHumans({ seed: options.seed ?? Date.now() });

  function broadcast(chunk: Uint8Array) {
    for (const [controller, leave] of telao) {
      try {
        controller.enqueue(chunk);
      } catch {
        leave();
      }
    }
  }

  /** A phone's view, or why it has none: expelled, left, or a restart. */
  function phoneEvent(sessionId: string): PhoneEvent {
    const view = phoneView(world, sessionId);
    if (view) {
      return view;
    }
    if (expelled.has(sessionId)) {
      return { expulso: true };
    }
    return left.has(sessionId) ? { saiu: true } : { reiniciou: true };
  }

  function publishPhones() {
    for (const [sessionId, streams] of phones) {
      const chunk = sseEvent("snapshot", phoneEvent(sessionId));
      for (const [controller, leave] of streams) {
        try {
          controller.enqueue(chunk);
        } catch {
          leave();
        }
      }
    }
  }

  const admin = createAdminApi({
    secret: options.adminSecret,
    world: () => world,
    setWorld: (next) => {
      world = next;
    },
    simulated,
    jukebox,
    musicGenerations: options.musicGenerations,
    // The admin's stream counts as someone watching; simulated people do not.
    watch,
    connected: (sessionId) => (phones.get(sessionId)?.size ?? 0) > 0,
    spending: () => scheduler.budget(),
    // The models' routes, behind the same secret.
    otherRoutes: modelRoutes,
    expelled: (sessionId) => {
      expelled.add(sessionId);
      publishPhones();
    },
    // A restart starts the session over (a rehearsal, then the real one):
    // the expelled come back and the spending ceiling counts from zero.
    restarted: () => {
      expelled.clear();
      left.clear();
      scheduler.resetBudget();
      log("Spending reset to zero");
      publishPhones();
    },
    publishNow: () => {
      broadcast(sseEvent("snapshot", telaoSnapshot()));
      publishPhones();
    },
    log,
  });

  const tickTimer = setInterval(() => {
    const next = tick(world, {
      elapsedMs: tickMs,
      results: [...unwatched, ...scheduler.drain()],
      models,
    });
    world = simulated.act(next.world);
    unwatched = [];
    for (const request of next.requests) {
      if (watched()) {
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
  const publishTimer = setInterval(() => {
    broadcast(sseEvent("snapshot", telaoSnapshot()));
    publishPhones();
  }, options.publishMs ?? 200);
  const adminTimer = setInterval(admin.publish, ADMIN_PUBLISH_MS);
  const keepaliveTimer = setInterval(() => {
    const keepalive = encoder.encode(": keepalive\n\n");
    broadcast(keepalive);
    for (const streams of phones.values()) {
      for (const [controller, leave] of streams) {
        try {
          controller.enqueue(keepalive);
        } catch {
          leave();
        }
      }
    }
  }, KEEPALIVE_MS);

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
        controller.enqueue(sseEvent("snapshot", telaoSnapshot()));
        telao.set(controller, leave);
      },
      cancel: leave,
    });
    request.signal.addEventListener("abort", leave);
    return new Response(stream, { headers: sseHeaders() });
  }

  /** One person's private stream: their boneco, its thoughts, the question. */
  function phoneStream(request: Request, sessionId: string): Response {
    if (
      !(
        privateView(world, sessionId) ||
        expelled.has(sessionId) ||
        left.has(sessionId)
      )
    ) {
      return new Response("Sessão desconhecida.", { status: 404 });
    }
    let self: ReadableStreamDefaultController<Uint8Array> | undefined;
    const unwatch = watch();
    const leave = () => {
      unwatch();
      const streams = phones.get(sessionId);
      if (self && streams) {
        streams.delete(self);
        if (streams.size === 0) {
          phones.delete(sessionId);
        }
      }
    };
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        self = controller;
        controller.enqueue(encoder.encode(`retry: ${SSE_RETRY_MS}\n\n`));
        controller.enqueue(sseEvent("snapshot", phoneEvent(sessionId)));
        const streams = phones.get(sessionId) ?? new Map();
        streams.set(controller, leave);
        phones.set(sessionId, streams);
      },
      cancel: leave,
    });
    request.signal.addEventListener("abort", leave);
    return new Response(stream, { headers: sseHeaders() });
  }

  async function enter(request: Request): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) {
      return new Response("O corpo precisa ser JSON.", { status: 400 });
    }
    const sessionId =
      body.sessao === undefined ? crypto.randomUUID() : sessionOf(body.sessao);
    if (expelled.has(sessionId)) {
      return Response.json(
        { ok: false, erro: "O host tirou este boneco do bloco." },
        { status: 403 }
      );
    }
    // The name and the look count only for a new boneco; a known session
    // keeps its own.
    const known = privateView(world, sessionId) !== null;
    const asked = known
      ? { name: null, look: null }
      : newcomerChoices(world, body);
    if ("refused" in asked) {
      return asked.refused;
    }
    const joined = join(world, { sessionId, ...asked });
    if (joined.full) {
      return Response.json(
        {
          ok: false,
          lotado: true,
          erro: "A praça lotou. Acompanhe pelo telão.",
        },
        { status: 409 }
      );
    }
    ({ world } = joined);
    left.delete(sessionId);
    if (joined.created) {
      log(`${joined.bonecoId} arrived`);
    }
    return Response.json({
      sessao: sessionId,
      boneco: joined.bonecoId,
      created: joined.created,
    });
  }

  async function respond(request: Request): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) {
      return new Response("O corpo precisa ser JSON.", { status: 400 });
    }
    const sessionId = sessionOf(body.sessao);
    if (typeof body.pergunta !== "string") {
      return new Response("Falta a pergunta.", { status: 400 });
    }
    const answer: HumanAnswer = { askId: body.pergunta };
    if (typeof body.opcao === "number") {
      answer.choice = body.opcao;
    }
    if (typeof body.texto === "string") {
      answer.text = body.texto;
    }
    answer.skip = body.pular === true;
    answer.typing = body.digitando === true;
    const result = answerHuman(world, { ...answer, sessionId });
    if (result.error) {
      return Response.json({ ok: false, erro: result.error }, { status: 409 });
    }
    ({ world } = result);
    publishPhones();
    return Response.json({ ok: true });
  }

  /**
   * The person leaves the square from the phone: the boneco goes as if the
   * host expelled it, but nobody is kept out, and entering again gives a new
   * one.
   */
  async function quit(request: Request): Promise<Response> {
    const body = await jsonBody(request);
    if (!body) {
      return new Response("O corpo precisa ser JSON.", { status: 400 });
    }
    const sessionId = sessionOf(body.sessao);
    const result = leaveSquare(world, sessionId);
    if (!result.bonecoId) {
      return Response.json(
        { ok: false, erro: "Este boneco já não está na praça." },
        { status: 404 }
      );
    }
    ({ world } = result);
    left.add(sessionId);
    log(`${result.bonecoId} left`);
    broadcast(sseEvent("snapshot", telaoSnapshot()));
    publishPhones();
    return Response.json({ ok: true, boneco: result.bonecoId });
  }

  /** A telão says whether its sound is on and what it plays, for the admin. */
  async function soundReport(request: Request): Promise<Response> {
    const body = await jsonBody(request);
    const id = body?.telao;
    const playing = body?.tocando ?? null;
    if (
      !(
        typeof id === "string" &&
        SESSION_ID.test(id) &&
        typeof body?.ativo === "boolean" &&
        (playing === null ||
          (typeof playing === "string" && playing.length <= 64))
      )
    ) {
      return new Response("Telão inválido.", { status: 400 });
    }
    jukebox.report(id, { enabled: body.ativo, playing });
    return Response.json({ ok: true });
  }

  /** The public API, by method and path. */
  const routes: Record<string, (request: Request) => Promise<Response>> = {
    "POST /api/entrar": enter,
    "POST /api/responder": respond,
    "POST /api/sair": quit,
    "POST /api/telao/som": soundReport,
    // The welcome greys out the looks already on the square.
    "GET /api/visuais": () =>
      Promise.resolve(
        Response.json(
          { total: LOOKS, emUso: looksInUse(world) },
          { headers: { "Cache-Control": "no-store" } }
        )
      ),
    "GET /api/models": () => Promise.resolve(publicModels()),
    "GET /api/config": () =>
      Promise.resolve(Response.json({ publicUrl: options.publicUrl ?? null })),
  };

  /** A generated track, served from the world's own copy. */
  function musicFile(request: Request, pathname: string): Response {
    const file =
      request.method === "GET" || request.method === "HEAD"
        ? options.musicFiles?.get(pathname)
        : undefined;
    if (!file) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(file.bytes, {
      headers: {
        "Content-Type": file.type,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  async function api(request: Request, pathname: string): Promise<Response> {
    if (pathname.startsWith(MUSIC_PATH)) {
      return musicFile(request, pathname);
    }
    const route = routes[`${request.method} ${pathname}`];
    if (!(route && Object.hasOwn(routes, `${request.method} ${pathname}`))) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof Response) {
        return error;
      }
      throw error;
    }
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

  function adminState() {
    return Response.json({
      models: modelRows(),
      spending: scheduler.budget(),
    });
  }

  /** The models' admin routes; the secret was checked before. */
  async function modelRoutes(
    request: Request,
    pathname: string
  ): Promise<Response | undefined> {
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

  function eventStream(
    request: Request,
    bunServer: { timeout: (request: Request, seconds: number) => void },
    pathname: string,
    searchParams: URLSearchParams
  ): Response {
    if (pathname === "/events/telao") {
      // The stream stays open; Bun's idle timeout must not close it.
      bunServer.timeout(request, 0);
      return telaoStream(request);
    }
    if (pathname === "/events/celular") {
      const sessionId = searchParams.get("sessao") ?? "";
      if (!SESSION_ID.test(sessionId)) {
        return new Response("Sessão inválida.", { status: 400 });
      }
      bunServer.timeout(request, 0);
      return phoneStream(request, sessionId);
    }
    return new Response("Not Found", { status: 404 });
  }

  /**
   * A phone entering or answering, or the admin's page acting: only a call
   * the server accepted counts as someone there, never a refused one.
   */
  function present(response: Response): Response {
    if (response.ok) {
      activeUntil = Date.now() + API_ACTIVITY_MS;
    }
    return response;
  }

  const server = Bun.serve({
    // `::` takes IPv6 and IPv4; Railway's private network needs IPv6.
    hostname: options.host ?? "::",
    port: options.port ?? 0,
    fetch(request, bunServer) {
      const { pathname, searchParams } = new URL(request.url);
      if (pathname.startsWith("/api/")) {
        if (pathname.startsWith("/api/admin/")) {
          // The admin's state stream stays open like the others.
          bunServer.timeout(request, 0);
          return admin.handle(request, pathname).then(present);
        }
        return api(request, pathname).then(present);
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
          viewers,
        });
      }
      if (pathname.startsWith("/events/")) {
        return eventStream(request, bunServer, pathname, searchParams);
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
        adminTimer,
        keepaliveTimer,
      ]) {
        clearInterval(timer);
      }
      admin.stop();
      for (const controller of telao.keys()) {
        try {
          controller.close();
        } catch {
          // The telão already left.
        }
      }
      telao.clear();
      await roomEvents.stop();
      for (const streams of phones.values()) {
        for (const controller of streams.keys()) {
          try {
            controller.close();
          } catch {
            // The phone already left.
          }
        }
      }
      phones.clear();
      await server.stop(true);
      await refreshing;
    },
  };
}
