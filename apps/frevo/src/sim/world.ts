// The world simulation. Pure: no I/O, no real clock, no randomness that is not
// in the state. `step` takes the state, the time that passed and what brains
// answered, and returns the next state plus the decisions it is waiting for.

export interface Place {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface WorldMap {
  height: number;
  places: Place[];
  width: number;
}

/** What a boneco can do. Later phases add to this union. */
export interface WalkAction {
  placeId: string;
  /** A short line in Portuguese; it becomes the balloon on the telão. */
  speech: string;
  type: "walk";
}
export type Action = WalkAction;

/** A decision the simulation wants from a brain before `deadlineMs`. */
export interface DecisionRequest {
  boneco: { id: string; name: string };
  /** World time after which the boneco stops waiting and goes on autopilot. */
  deadlineMs: number;
  id: string;
  /** The place the boneco is standing at, when it is at one. */
  placeId: string | null;
  places: Place[];
}

export type BrainResult =
  | {
      action: Action;
      /** The model that answered, as shown to people. */
      model?: string;
      ok: true;
      requestId: string;
    }
  | { ok: false; reason: string; requestId: string };

export type Facing = "down" | "left" | "right" | "up";
export type BrainSource = "autopilot" | "model";

interface Boneco {
  brain: BrainSource | null;
  decisions: number;
  facing: Facing;
  id: string;
  model: string | null;
  name: string;
  pending: { deadlineMs: number; requestId: string } | null;
  restUntilMs: number;
  speech: { text: string; untilMs: number } | null;
  target: Place | null;
  x: number;
  y: number;
}

export interface WorldRules {
  /** How long a boneco waits for its brain before going on autopilot. */
  decisionTimeoutMs: number;
  /** Pause at a place before the next decision. */
  restMs: number;
  speechMaxLength: number;
  speechMs: number;
  /** Map units per second. */
  speed: number;
}

export interface World {
  bonecos: Boneco[];
  map: WorldMap;
  /** State of the seeded generator; the only source of randomness. */
  rng: number;
  rules: WorldRules;
  timeMs: number;
}

export interface PublicBoneco {
  brain: BrainSource | null;
  facing: Facing;
  id: string;
  model: string | null;
  name: string;
  speech: string | null;
  thinking: boolean;
  walking: boolean;
  x: number;
  y: number;
}

/** What the telão may show. */
export interface PublicSnapshot {
  bonecos: PublicBoneco[];
  map: WorldMap;
  timeMs: number;
}

export const DEFAULT_RULES: WorldRules = {
  decisionTimeoutMs: 12_000,
  restMs: 1500,
  speechMaxLength: 140,
  speechMs: 6000,
  speed: 14,
};

/** The square, in a 16:9 space so the telão shows it without scrolling. */
export const PRACA: WorldMap = {
  width: 160,
  height: 90,
  places: [
    { id: "marco-zero", name: "Marco Zero", x: 80, y: 46 },
    { id: "coreto", name: "Coreto", x: 30, y: 24 },
    { id: "fonte", name: "Fonte", x: 126, y: 26 },
    { id: "tapioca", name: "Barraca de tapioca", x: 28, y: 68 },
    { id: "palco", name: "Palco do frevo", x: 124, y: 68 },
    { id: "ponte", name: "Ponte", x: 80, y: 14 },
  ],
};

const NAMES = [
  "Capiba",
  "Lia",
  "Naná",
  "Chico",
  "Alceu",
  "Dona Santa",
  "Nelson",
  "Lenine",
  "Clarice",
  "Zuzinha",
];

const RNG_MODULUS = 2_147_483_647;
const RNG_MULTIPLIER = 48_271;

/** Any integer seed as a valid generator state, from 1 to the modulus minus 1. */
function seedState(seed: number): number {
  const span = RNG_MODULUS - 1;
  return (((Math.trunc(seed) % span) + span) % span) + 1;
}

/** Park-Miller: one state in, a number in [0, 1) and the next state out. */
function random(state: number): { next: number; value: number } {
  const next = (state * RNG_MULTIPLIER) % RNG_MODULUS;
  return { next, value: (next - 1) / (RNG_MODULUS - 1) };
}

export function createWorld(options: {
  bonecos: number;
  map?: WorldMap;
  rules?: Partial<WorldRules>;
  seed: number;
}): World {
  const map = options.map ?? PRACA;
  let rng = seedState(options.seed);
  const bonecos: Boneco[] = [];
  for (let index = 0; index < options.bonecos; index += 1) {
    const x = random(rng);
    const y = random(x.next);
    rng = y.next;
    bonecos.push({
      id: `boneco-${index + 1}`,
      name: NAMES[index % NAMES.length] as string,
      x: 10 + x.value * (map.width - 20),
      y: 10 + y.value * (map.height - 20),
      facing: "down",
      target: null,
      speech: null,
      pending: null,
      restUntilMs: 0,
      brain: null,
      model: null,
      decisions: 0,
    });
  }
  return {
    bonecos,
    map,
    rng,
    rules: { ...DEFAULT_RULES, ...options.rules },
    timeMs: 0,
  };
}

function facingToward(dx: number, dy: number, current: Facing): Facing {
  if (dx === 0 && dy === 0) {
    return current;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

function move(boneco: Boneco, world: World, elapsedMs: number): Boneco {
  const { target } = boneco;
  if (!target) {
    return boneco;
  }
  const dx = target.x - boneco.x;
  const dy = target.y - boneco.y;
  const distance = Math.hypot(dx, dy);
  const reach = (world.rules.speed * elapsedMs) / 1000;
  if (distance <= reach) {
    return {
      ...boneco,
      x: target.x,
      y: target.y,
      target: null,
      restUntilMs: world.timeMs + world.rules.restMs,
    };
  }
  return {
    ...boneco,
    x: boneco.x + (dx / distance) * reach,
    y: boneco.y + (dy / distance) * reach,
    facing: facingToward(dx, dy, boneco.facing),
  };
}

function placeAt(world: World, boneco: Boneco): Place | undefined {
  return world.map.places.find(
    (place) => place.x === boneco.x && place.y === boneco.y
  );
}

function applyAction(
  boneco: Boneco,
  world: World,
  action: Action,
  model: string | undefined
): Boneco | undefined {
  const target = world.map.places.find((place) => place.id === action.placeId);
  if (!target) {
    return;
  }
  const text = action.speech.trim().slice(0, world.rules.speechMaxLength);
  return {
    ...boneco,
    target,
    pending: null,
    brain: "model",
    model: model ?? null,
    speech: text
      ? { text, untilMs: world.timeMs + world.rules.speechMs }
      : null,
  };
}

/** The rule a boneco follows when no brain decides: walk somewhere else. */
function autopilot(boneco: Boneco, world: World): Boneco {
  const here = placeAt(world, boneco);
  const elsewhere = world.map.places.filter((place) => place !== here);
  const roll = random(world.rng);
  world.rng = roll.next;
  return {
    ...boneco,
    target: elsewhere[Math.floor(roll.value * elsewhere.length)] ?? null,
    pending: null,
    brain: "autopilot",
    model: null,
    speech: null,
  };
}

export function step(
  world: World,
  input: { elapsedMs: number; results?: BrainResult[] }
): { requests: DecisionRequest[]; world: World } {
  const next: World = { ...world, timeMs: world.timeMs + input.elapsedMs };
  const results = new Map(
    (input.results ?? []).map((result) => [result.requestId, result])
  );
  const requests: DecisionRequest[] = [];

  next.bonecos = world.bonecos.map((previous) => {
    let boneco = previous;
    const answer = boneco.pending
      ? results.get(boneco.pending.requestId)
      : undefined;
    if (answer?.ok) {
      boneco = applyAction(boneco, next, answer.action, answer.model) ?? boneco;
    }
    // Still waiting: a failed or unusable answer, or the deadline, ends it.
    if (
      boneco.pending &&
      (answer || next.timeMs >= boneco.pending.deadlineMs)
    ) {
      boneco = autopilot(boneco, next);
    }
    boneco = move(boneco, next, input.elapsedMs);
    if (
      !(boneco.target || boneco.pending) &&
      next.timeMs >= boneco.restUntilMs
    ) {
      const request: DecisionRequest = {
        id: `${boneco.id}#${boneco.decisions + 1}`,
        boneco: { id: boneco.id, name: boneco.name },
        deadlineMs: next.timeMs + next.rules.decisionTimeoutMs,
        placeId: placeAt(next, boneco)?.id ?? null,
        places: next.map.places,
      };
      requests.push(request);
      boneco = {
        ...boneco,
        decisions: boneco.decisions + 1,
        pending: { requestId: request.id, deadlineMs: request.deadlineMs },
      };
    }
    return boneco;
  });

  return { world: next, requests };
}

export function publicSnapshot(world: World): PublicSnapshot {
  return {
    timeMs: world.timeMs,
    map: world.map,
    bonecos: world.bonecos.map((boneco) => ({
      id: boneco.id,
      name: boneco.name,
      x: boneco.x,
      y: boneco.y,
      facing: boneco.facing,
      walking: boneco.target !== null,
      thinking: boneco.pending !== null,
      speech:
        boneco.speech && boneco.speech.untilMs > world.timeMs
          ? boneco.speech.text
          : null,
      brain: boneco.brain,
      model: boneco.model,
    })),
  };
}
