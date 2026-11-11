// Simulated humans: fake people on the server, so the host can run the whole
// dynamic with few people or alone in a rehearsal. Each one arrives the way a
// person does (a session joining the world) and answers whatever question
// its boneco opens, after a human delay, sometimes letting the time run out.
// They look only at the shape of the question (choices or text), never at
// its purpose, so the questions later phases add need nothing here.
// Their bonecos think with the Room's models like everyone else's.
import { expel } from "../sim/admin";
import { answerHuman, type HumanAnswer, join, type World } from "../sim/world";

export interface SimulatedHumans {
  /** Answers the questions that are due; call it after every step. */
  act: (world: World) => World;
  /** Brings simulated people in until the square has `total` bonecos. */
  fill: (world: World, total: number) => { added: number; world: World };
  isSimulated: (sessionId: string) => boolean;
  removeAll: (world: World) => { removed: number; world: World };
  /** Forgets everyone, for when the world restarts empty. */
  reset: () => void;
}

export interface SimulatedHumansOptions {
  /** Fastest answer. */
  minDelayMs?: number;
  seed: number;
  /** Share of questions they let run out, as a distracted person would. */
  silentShare?: number;
}

/** What they write when a question asks for text. */
const TEXTS = [
  "Adoro dançar frevo na rua",
  "Toco pandeiro desde criança",
  "Sou de Olinda, de coração",
  "Vivo de café e de música",
  "Faço tapioca no domingo",
  "Gosto de mar e de manguebeat",
  "Danço mal, mas danço muito",
  "Sigo o Galo da Madrugada todo ano",
];

const MODULUS = 2_147_483_647;
/** Answers land this long before the countdown ends, at the latest. */
const MARGIN_MS = 400;
const SLOWEST_MS = 9000;

interface Plan {
  answer: HumanAnswer | null;
  atMs: number;
  sessionId: string;
}

export function createSimulatedHumans(
  options: SimulatedHumansOptions
): SimulatedHumans {
  const minDelayMs = options.minDelayMs ?? 1200;
  const silentShare = options.silentShare ?? 0.08;
  let state = (Math.abs(Math.trunc(options.seed)) % (MODULUS - 1)) + 1;
  const sessions = new Set<string>();
  /** By question id: when and how it will be answered. */
  const plans = new Map<string, Plan>();
  let counter = 0;

  function random(): number {
    state = (state * 48_271) % MODULUS;
    return (state - 1) / (MODULUS - 1);
  }

  function pick<T>(items: readonly T[]): T {
    return items[Math.floor(random() * items.length)] as T;
  }

  function decideAnswer(ask: {
    id: string;
    options: string[];
    textMaxLength: number | null;
  }): HumanAnswer {
    if (ask.options.length > 0) {
      return {
        askId: ask.id,
        choice: Math.floor(random() * ask.options.length),
      };
    }
    if (ask.textMaxLength !== null && random() < 0.5) {
      return { askId: ask.id, text: pick(TEXTS).slice(0, ask.textMaxLength) };
    }
    return { askId: ask.id, skip: true };
  }

  function plan(
    world: World,
    sessionId: string,
    ask: NonNullable<World["bonecos"][number]["ask"]>
  ) {
    const remaining = ask.deadlineMs - world.timeMs;
    if (random() < silentShare) {
      plans.set(ask.id, {
        sessionId,
        atMs: Number.POSITIVE_INFINITY,
        answer: null,
      });
      return;
    }
    // Most people answer in a few seconds; some take longer.
    const latest = Math.max(
      minDelayMs,
      Math.min(SLOWEST_MS, remaining - MARGIN_MS)
    );
    const delay = minDelayMs + random() ** 1.6 * (latest - minDelayMs);
    plans.set(ask.id, {
      sessionId,
      atMs: world.timeMs + Math.round(delay),
      answer: decideAnswer(ask),
    });
  }

  return {
    isSimulated: (sessionId) => sessions.has(sessionId),

    fill(world, total) {
      let next = world;
      let added = 0;
      while (next.bonecos.length < total) {
        counter += 1;
        const sessionId = `simulado-${counter}-${Math.floor(random() * 1e9).toString(36)}`;
        sessions.add(sessionId);
        ({ world: next } = join(next, { sessionId }));
        added += 1;
      }
      return { world: next, added };
    },

    removeAll(world) {
      let next = world;
      let removed = 0;
      for (const boneco of world.bonecos) {
        if (boneco.sessionId && sessions.has(boneco.sessionId)) {
          ({ world: next } = expel(next, boneco.id));
          removed += 1;
        }
      }
      sessions.clear();
      plans.clear();
      return { world: next, removed };
    },

    reset() {
      sessions.clear();
      plans.clear();
    },

    act(world) {
      let next = world;
      const open = new Set<string>();
      for (const boneco of world.bonecos) {
        const { ask, sessionId } = boneco;
        if (!(ask && sessionId && sessions.has(sessionId))) {
          continue;
        }
        open.add(ask.id);
        if (!plans.has(ask.id)) {
          plan(world, sessionId, ask);
        }
        const due = plans.get(ask.id);
        if (due?.answer && due.atMs <= world.timeMs) {
          plans.delete(ask.id);
          next = answerHuman(next, { ...due.answer, sessionId }).world;
        }
      }
      for (const askId of plans.keys()) {
        if (!open.has(askId)) {
          plans.delete(askId);
        }
      }
      return next;
    },
  };
}
