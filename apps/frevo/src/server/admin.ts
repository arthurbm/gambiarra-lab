// The host's routes under /api/admin/*. Every one needs
// `Authorization: Bearer <secret>`; without a configured secret they all stay
// closed. The state stream is read with fetch, so the secret never goes in a
// URL the browser or a proxy might log.
import { timingSafeEqual } from "node:crypto";
import type { Jukebox } from "../music/jukebox";
import { expel, setSilenced } from "../sim/admin";
import {
  desfileView,
  nextBloco,
  previousBloco,
  setChosen,
} from "../sim/desfile";
import {
  advancePhase,
  restartWorld,
  setPaused,
  setPhaseDurations,
  type TimedPhase,
} from "../sim/phases";
import type { World } from "../sim/world";
import type { SimulatedHumans } from "./simulated";
import { type AdminState, adminState, type Spending } from "./views";

export interface AdminContext {
  /** Phones of this session have a stream open now. */
  connected: (sessionId: string) => boolean;
  /** The person behind this session was expelled: tell the phone, keep it out. */
  expelled: (sessionId: string) => void;
  /** The jury's music; without it the jury's audio routes answer 404. */
  jukebox?: Jukebox;
  log: (line: string) => void;
  /** Routes other tickets add under /api/admin/*, after the secret was checked. */
  otherRoutes?: (
    request: Request,
    pathname: string
  ) => Promise<Response | undefined>;
  /** Sends the telão and the phones the world now, without waiting a tick. */
  publishNow: () => void;
  /** The world went back to zero: tell the phones. */
  restarted: () => void;
  secret: string | undefined;
  setWorld: (world: World) => void;
  simulated: SimulatedHumans;
  /** The scheduler's estimate; null while it reports none. */
  spending: () => Spending | null;
  /** Counts an open state stream as someone watching; returns how it leaves. */
  watch?: () => () => void;
  world: () => World;
}

export interface AdminApi {
  handle: (request: Request, pathname: string) => Promise<Response>;
  /** Sends the state to every open admin stream. */
  publish: () => void;
  stop: () => void;
}

const encoder = new TextEncoder();
const MAX_SIMULATED_TOTAL = 60;
const TIMED: TimedPhase[] = ["formar", "compor", "desfile"];

function refused() {
  return Response.json({ erro: "segredo inválido" }, { status: 401 });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function createAdminApi(context: AdminContext): AdminApi {
  /** Each open state stream and the way it leaves. */
  const streams = new Map<
    ReadableStreamDefaultController<Uint8Array>,
    () => void
  >();

  function allowed(request: Request): boolean {
    const { secret } = context;
    if (!secret) {
      return false;
    }
    const given = Buffer.from(request.headers.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${secret}`);
    return given.length === expected.length && timingSafeEqual(given, expected);
  }

  function state(): AdminState {
    return adminState(context.world(), {
      connected: context.connected,
      isSimulated: context.simulated.isSimulated,
      spending: context.spending(),
      ...(context.jukebox
        ? {
            jury: {
              playing: context.jukebox.current(),
              sound: context.jukebox.sound(),
              tracks: context.jukebox.tracks(),
            },
          }
        : {}),
    });
  }

  function chunk() {
    return encoder.encode(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
  }

  function publish() {
    if (streams.size === 0) {
      return;
    }
    const data = chunk();
    for (const [controller, leave] of streams) {
      try {
        controller.enqueue(data);
      } catch {
        leave();
      }
    }
  }

  /** Applies a change to the world, shows it everywhere and answers the state. */
  function change(world: World, line: string): Response {
    context.setWorld(world);
    context.log(`Admin: ${line}`);
    context.publishNow();
    publish();
    return Response.json(state());
  }

  function stream(request: Request): Response {
    let self: ReadableStreamDefaultController<Uint8Array> | undefined;
    const unwatch = context.watch?.() ?? (() => undefined);
    const leave = () => {
      unwatch();
      if (self) {
        streams.delete(self);
      }
    };
    request.signal.addEventListener("abort", leave);
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          self = controller;
          controller.enqueue(encoder.encode("retry: 1000\n\n"));
          controller.enqueue(chunk());
          streams.set(controller, leave);
        },
        cancel: leave,
      }),
      {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      }
    );
  }

  function bonecoOf(input: Record<string, unknown>): string | null {
    const id = input.boneco;
    return typeof id === "string" &&
      context.world().bonecos.some((boneco) => boneco.id === id)
      ? id
      : null;
  }

  function notFound() {
    return Response.json({ erro: "boneco não encontrado" }, { status: 404 });
  }

  /** A bloco of the parade, by the body's `bloco`. */
  function paradeBloco(world: World, input: Record<string, unknown>) {
    return desfileView(world)?.blocos.find((bloco) => bloco.id === input.bloco);
  }

  function choose(world: World, input: Record<string, unknown>): Response {
    const id = typeof input.bloco === "string" ? input.bloco : "";
    const chosen = input.escolhido !== false;
    const result = setChosen(world, id, chosen);
    if (result.error) {
      return Response.json({ erro: result.error }, { status: 409 });
    }
    const bloco = paradeBloco(result.world, input);
    if (chosen && bloco) {
      // The music is made in the background while the desfile goes on.
      context.jukebox?.prepare({
        blocoId: bloco.id,
        blocoName: bloco.name,
        refrain: bloco.refrain,
      });
    }
    return change(result.world, `${chosen ? "chose" : "unchose"} ${id}`);
  }

  function play(world: World, input: Record<string, unknown>): Response {
    const bloco = paradeBloco(world, input);
    if (!(bloco && context.jukebox)) {
      return Response.json({ erro: "bloco não encontrado" }, { status: 404 });
    }
    const command = context.jukebox.play({
      blocoId: bloco.id,
      blocoName: bloco.name,
      refrain: bloco.refrain,
    });
    return change(world, `played ${bloco.id} (${command.url})`);
  }

  function durationsOf(input: Record<string, unknown>) {
    const durations: Partial<Record<TimedPhase, number>> = {};
    for (const phase of TIMED) {
      if (typeof input[phase] === "number") {
        durations[phase] = input[phase] as number;
      }
    }
    return durations;
  }

  function totalOf(input: Record<string, unknown>) {
    return typeof input.total === "number" && Number.isInteger(input.total)
      ? Math.min(MAX_SIMULATED_TOTAL, Math.max(0, input.total))
      : 25;
  }

  /** Each action by route, with the JSON body (empty when there is none). */
  const actions: Record<
    string,
    (world: World, input: Record<string, unknown>) => Response
  > = {
    iniciar: (world) =>
      world.phase === "entrada"
        ? change(setPaused(advancePhase(world), false), "started")
        : Response.json(state()),
    pausar: (world) => change(setPaused(world, true), "paused"),
    retomar: (world) => change(setPaused(world, false), "resumed"),
    avancar: (world) =>
      change(advancePhase(world), `advanced from ${world.phase}`),
    duracoes: (world, input) =>
      change(
        setPhaseDurations(world, durationsOf(input)),
        "changed the durations"
      ),
    reiniciar: (world) => {
      context.simulated.reset();
      context.jukebox?.reset();
      const response = change(restartWorld(world), "restarted from zero");
      context.restarted();
      return response;
    },
    simulados: (world, input) => {
      const filled = context.simulated.fill(world, totalOf(input));
      return change(filled.world, `${filled.added} simulated people joined`);
    },
    "simulados/remover": (world) => {
      const removed = context.simulated.removeAll(world);
      return change(removed.world, `${removed.removed} simulated people left`);
    },
    expulsar: (world, input) => {
      const id = bonecoOf(input);
      if (!id) {
        return notFound();
      }
      const result = expel(world, id);
      const response = change(result.world, `expelled ${id}`);
      if (
        result.sessionId &&
        !context.simulated.isSimulated(result.sessionId)
      ) {
        context.expelled(result.sessionId);
      }
      return response;
    },
    "desfile/proximo": (world) =>
      change(nextBloco(world), "moved the desfile to the next bloco"),
    "desfile/anterior": (world) =>
      change(previousBloco(world), "moved the desfile back a bloco"),
    "desfile/escolher": choose,
    "desfile/tocar": play,
    "desfile/parar": (world) => {
      context.jukebox?.stop();
      return change(world, "stopped the music");
    },
    silenciar: (world, input) => {
      const id = bonecoOf(input);
      if (!id) {
        return notFound();
      }
      const silenced = input.silenciado !== false;
      return change(
        setSilenced(world, id, silenced),
        `${silenced ? "silenced" : "unsilenced"} ${id}`
      );
    },
  };

  return {
    publish,
    stop() {
      for (const [controller, leave] of streams) {
        try {
          controller.close();
        } catch {
          // Already gone.
        }
        leave();
      }
      streams.clear();
    },
    async handle(request, pathname) {
      if (!allowed(request)) {
        return refused();
      }
      const route = pathname.slice("/api/admin/".length);
      if (request.method === "GET" && route === "estado") {
        return Response.json(state());
      }
      if (request.method === "GET" && route === "eventos") {
        return stream(request);
      }
      const run = actions[route];
      if (request.method === "POST" && run && Object.hasOwn(actions, route)) {
        return run(context.world(), await body(request));
      }
      const other = await context.otherRoutes?.(request, pathname);
      if (other) {
        return other;
      }
      return Response.json({ erro: "rota desconhecida" }, { status: 404 });
    },
  };
}
