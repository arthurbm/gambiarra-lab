// The host's routes under /api/admin/*. Every one needs
// `Authorization: Bearer <secret>`; without a configured secret they all stay
// closed. The state stream is read with fetch, so the secret never goes in a
// URL the browser or a proxy might log.
import { timingSafeEqual } from "node:crypto";
import { expel, setSilenced } from "../sim/admin";
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
  log: (line: string) => void;
  /** Sends the telão and the phones the world now, without waiting a tick. */
  publishNow: () => void;
  /** The world went back to zero: tell the phones. */
  restarted: () => void;
  secret: string | undefined;
  setWorld: (world: World) => void;
  simulated: SimulatedHumans;
  /** The scheduler's estimate; null while it reports none. */
  spending: () => Spending | null;
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
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();

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
    for (const controller of streams) {
      try {
        controller.enqueue(data);
      } catch {
        streams.delete(controller);
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
    const leave = () => {
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
          streams.add(controller);
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

  async function action(
    request: Request,
    route: string
  ): Promise<Response | undefined> {
    const world = context.world();
    switch (route) {
      case "iniciar":
        return world.phase === "entrada"
          ? change(setPaused(advancePhase(world), false), "started")
          : Response.json(state());
      case "pausar":
        return change(setPaused(world, true), "paused");
      case "retomar":
        return change(setPaused(world, false), "resumed");
      case "avancar":
        return change(advancePhase(world), `advanced from ${world.phase}`);
      case "duracoes": {
        const input = await body(request);
        const durations: Partial<Record<TimedPhase, number>> = {};
        for (const phase of TIMED) {
          if (typeof input[phase] === "number") {
            durations[phase] = input[phase] as number;
          }
        }
        return change(
          setPhaseDurations(world, durations),
          "changed the durations"
        );
      }
      case "reiniciar": {
        context.simulated.reset();
        const response = change(restartWorld(world), "restarted from zero");
        context.restarted();
        return response;
      }
      case "simulados": {
        const input = await body(request);
        const total =
          typeof input.total === "number" && Number.isInteger(input.total)
            ? Math.min(MAX_SIMULATED_TOTAL, Math.max(0, input.total))
            : 25;
        const filled = context.simulated.fill(world, total);
        return change(filled.world, `${filled.added} simulated people joined`);
      }
      case "simulados/remover": {
        const removed = context.simulated.removeAll(world);
        return change(
          removed.world,
          `${removed.removed} simulated people left`
        );
      }
      case "expulsar": {
        const id = bonecoOf(await body(request));
        if (!id) {
          return Response.json(
            { erro: "boneco não encontrado" },
            { status: 404 }
          );
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
      }
      case "silenciar": {
        const input = await body(request);
        const id = bonecoOf(input);
        if (!id) {
          return Response.json(
            { erro: "boneco não encontrado" },
            { status: 404 }
          );
        }
        const silenced = input.silenciado !== false;
        return change(
          setSilenced(world, id, silenced),
          `${silenced ? "silenced" : "unsilenced"} ${id}`
        );
      }
      default:
        return;
    }
  }

  return {
    publish,
    stop() {
      for (const controller of streams) {
        try {
          controller.close();
        } catch {
          // Already gone.
        }
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
      if (request.method === "POST") {
        const response = await action(request, route);
        if (response) {
          return response;
        }
      }
      return Response.json({ erro: "rota desconhecida" }, { status: 404 });
    },
  };
}
