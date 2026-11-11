// The world simulation. Pure: no I/O, no real clock, no randomness that is not
// in the state. `step` takes the state, the time that passed and what brains
// answered, and returns the next state plus the decisions it is waiting for.
// `join` and `answerHuman` take what people do on their phones.
import {
  type Ask,
  type AskOutcome,
  answerAsk,
  decideAlone,
  decidedAloneNotice,
  type HumanAnswer,
  openAsk,
} from "./ask";
import { filterModelText } from "./blocklist";
import {
  type Bloco,
  blocoAnswered,
  canWander,
  type FormarState,
  holdsDecision,
  stepFormar,
  talksOf,
} from "./formar";
import {
  acceptPersonality,
  acceptQuestion,
  fallbackPersonality,
  INSTRUMENTS,
  type Instrument,
  type Interview,
  type InterviewAnswer,
  isInstrument,
  OPEN_QUESTION,
  OPEN_TEXT_MAX_LENGTH,
  recordOpen,
  recordTap,
  reserveQuestion,
  startInterview,
  TAP_QUESTIONS,
} from "./interview";

export type { Ask, AskOutcome, HumanAnswer } from "./ask";
export type { Bloco } from "./formar";
export { INSTRUMENTS, type Instrument } from "./interview";

/** The phases of the dynamic, in order. */
export const PHASES = [
  "entrada",
  "formar",
  "compor",
  "desfile",
  "final",
] as const;
export type Phase = (typeof PHASES)[number];

/** How many looks the art has; a boneco's look is an index into them. */
export const LOOKS = 30;

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
/** An interview question the model wrote, with two or three choices. */
export interface QuestionAction {
  options: string[];
  question: string;
  type: "question";
}
/** How the boneco sees its human after the interview. */
export interface PersonalityAction {
  instrument: string;
  speech: string;
  /** Two short lines. */
  summary: string;
  type: "personality";
}
/** What a boneco says to another it met, and whether their humans match. */
export interface EncounterAction {
  affinity: boolean;
  speech: string;
  type: "encounter";
}
/** How the maestro splits the bonecos left without a bloco, by name. */
export interface MaestroAction {
  groups: string[][];
  speech: string;
  type: "maestro";
}
export type Action =
  | EncounterAction
  | MaestroAction
  | PersonalityAction
  | QuestionAction
  | WalkAction;

interface RequestBase {
  boneco: { id: string; name: string };
  /** World time after which the boneco stops waiting and goes on autopilot. */
  deadlineMs: number;
  id: string;
  /** The model the boneco was given; the scheduler prefers it. */
  model?: string | null;
}

/** Where to walk next. */
export interface WalkRequest extends RequestBase {
  kind?: "walk";
  /** The place the boneco is standing at, when it is at one. */
  placeId: string | null;
  places: Place[];
}

/** One tap question of the interview. */
export interface QuestionRequest extends RequestBase {
  /** Zero-based, out of `total`. */
  index: number;
  kind: "question";
  previous: { answer: string; question: string }[];
  total: number;
}

/** The two-line personality and the instrument, after the interview. */
export interface PersonalityRequest extends RequestBase {
  answers: { answer: string; question: string }[];
  /** What the human wrote; this request is the only place it goes. */
  freeText: string | null;
  instruments: readonly string[];
  kind: "personality";
}

/** Someone the boneco meets or the maestro groups, as a model sees them. */
export interface Acquaintance {
  instrument: string | null;
  name: string;
  /** The two lines from the interview; null when there was none. */
  personality: string[] | null;
}

/** Two bonecos met: one line to the other and whether their humans match. */
export interface EncounterRequest extends RequestBase {
  instrument: string | null;
  kind: "encounter";
  other: Acquaintance;
  personality: string[] | null;
}

/** The maestro, at the end of the formar phase, groups whoever is left. */
export interface MaestroRequest extends RequestBase {
  kind: "maestro";
  people: Acquaintance[];
  /** The size of each bloco to make, in order. */
  sizes: number[];
}

/** A decision the simulation wants from a brain before `deadlineMs`. */
export type DecisionRequest =
  | EncounterRequest
  | MaestroRequest
  | PersonalityRequest
  | QuestionRequest
  | WalkRequest;
export type DecisionKind = NonNullable<DecisionRequest["kind"]>;

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

/** A line in the boneco's recent thoughts, shown on its human's phone. */
export interface Thought {
  atMs: number;
  /** The model that wrote it; null for the boneco's own notices. */
  model: string | null;
  text: string;
  /** "aviso" is the boneco telling its human what it did alone. */
  tone: "aviso" | "fala";
}

export interface Boneco {
  ask: Ask | null;
  asks: number;
  /** The model the boneco was given on arrival. */
  assignedModel: string | null;
  blocoId: string | null;
  brain: BrainSource | null;
  decisions: number;
  facing: Facing;
  id: string;
  instrument: Instrument | null;
  interview: Interview | null;
  look: number;
  model: string | null;
  name: string;
  pending: {
    deadlineMs: number;
    kind: DecisionKind;
    requestId: string;
    /** World time the decision was asked at. */
    sinceMs: number;
  } | null;
  personality: string[] | null;
  restUntilMs: number;
  /** The phone's session; null for a simulated boneco. */
  sessionId: string | null;
  speech: { text: string; untilMs: number } | null;
  target: Place | null;
  thoughts: Thought[];
  /** The human's answer to joining a bloco, until the bloco reads it. */
  vote: { askId: string; yes: boolean } | null;
  x: number;
  y: number;
}

/** Something that just happened, for the short log on the telão. */
export interface WorldEvent {
  atMs: number;
  id: number;
  text: string;
}

export interface WorldRules {
  /** Countdown of every question a boneco asks its human. */
  askMs: number;
  /** Typing in an open question never stretches its wait past this. */
  askTypingCapMs: number;
  /** How long a boneco waits for its brain before going on autopilot. */
  decisionTimeoutMs: number;
  /** Events the telão's log keeps. */
  eventsKept: number;
  /** How long the interview waits for the model before a fixed question. */
  interviewThinkMs: number;
  /** How long the maestro may think before the square groups by distance. */
  maestroMs: number;
  /** The same two bonecos meet again only after this long. */
  meetCooldownMs: number;
  /** Two bonecos this close (in map units) meet. */
  meetRadius: number;
  /** Pause at a place before the next decision. */
  restMs: number;
  speechMaxLength: number;
  speechMs: number;
  /** Map units per second. */
  speed: number;
  thoughtsKept: number;
}

export interface World {
  blocos: Bloco[];
  bonecos: Boneco[];
  events: WorldEvent[];
  /** The formar phase's encounters and proposals; null before it starts. */
  formar: FormarState | null;
  map: WorldMap;
  /** The models of the Room, for spreading bonecos evenly among them. */
  models: string[];
  phase: Phase;
  /** State of the seeded generator; the only source of randomness. */
  rng: number;
  rules: WorldRules;
  timeMs: number;
}

export interface PublicBoneco {
  /** Waiting for its human to answer on the phone. */
  asking: boolean;
  /** The model the boneco was given; `model` may differ when another answered. */
  assignedModel: string | null;
  /** The bloco it belongs to, when it has one. */
  bloco: string | null;
  brain: BrainSource | null;
  facing: Facing;
  id: string;
  instrument: Instrument | null;
  look: number;
  model: string | null;
  name: string;
  speech: string | null;
  /** Waiting for a model right now. */
  thinking: boolean;
  /** For how long it has been waiting for a model, or null when it is not. */
  thinkingForMs: number | null;
  walking: boolean;
  x: number;
  y: number;
}

/** A bloco as the telão shows it. */
export interface PublicBloco {
  id: string;
  /** Index of the bloco's colour or mark, in formation order. */
  mark: number;
  /** Boneco ids. */
  members: string[];
  /** Where the bloco gathers. */
  spot: { x: number; y: number };
}

/** What the telão may show. */
export interface PublicSnapshot {
  blocos: PublicBloco[];
  bonecos: PublicBoneco[];
  /** The newest last. */
  events: WorldEvent[];
  map: WorldMap;
  phase: Phase;
  timeMs: number;
}

/** A boneco as another person's phone shows it. */
export interface Mate {
  id: string;
  instrument: Instrument | null;
  look: number;
  name: string;
}

/** One encounter, as the phone of one of the two shows it. */
export interface Talk {
  atMs: number;
  /** Whether this boneco felt its human and the other's match; null while it thinks. */
  liked: boolean | null;
  /** What this boneco said; null when it said nothing. */
  mine: string | null;
  theirs: string | null;
  with: Mate;
}

/** What one person's phone shows. Never the free text. */
export interface PrivateView {
  ask: {
    id: string;
    options: string[];
    question: string;
    /** Left on the countdown, so the phone does not depend on its clock. */
    remainingMs: number;
    textMaxLength: number | null;
    totalMs: number;
  } | null;
  /** The boneco's bloco and the others in it. */
  bloco: { id: string; mark: number; mates: Mate[] } | null;
  boneco: PublicBoneco & {
    assignedModel: string | null;
    personality: string[] | null;
  };
  interview: { answered: number; done: boolean; total: number } | null;
  phase: Phase;
  /** Encounters, oldest first. */
  talks: Talk[];
  thoughts: Thought[];
  timeMs: number;
}

export const DEFAULT_RULES: WorldRules = {
  askMs: 12_000,
  askTypingCapMs: 60_000,
  decisionTimeoutMs: 12_000,
  eventsKept: 12,
  interviewThinkMs: 8000,
  maestroMs: 10_000,
  meetCooldownMs: 30_000,
  meetRadius: 8,
  restMs: 1500,
  speechMaxLength: 140,
  speechMs: 6000,
  speed: 14,
  thoughtsKept: 8,
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

/** Names a boneco is given, drawn without repeating. */
const NAMES = [
  "Biu",
  "Tonho",
  "Quinha",
  "Neném",
  "Zefa",
  "Toinho",
  "Lia",
  "Naná",
  "Chico",
  "Dona Santa",
  "Zuzinha",
  "Mainha",
  "Seu Lula",
  "Docinho",
  "Preta",
  "Galeguinho",
  "Bia",
  "Juju",
  "Dedé",
  "Cacau",
  "Tetê",
  "Lelê",
  "Nino",
  "Duda",
  "Fafá",
  "Pipoca",
  "Cocada",
  "Tapioca",
  "Bolinho",
  "Caju",
  "Pitanga",
  "Maré",
  "Sereno",
  "Brisa",
  "Xodó",
  "Faísca",
  "Chuvisco",
  "Tamborim",
  "Ciranda",
  "Sombrinha",
];

const RNG_MODULUS = 2_147_483_647;
const RNG_MULTIPLIER = 48_271;
const ID_NUMBER = /(\d+)$/;

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

/** Draws from the world's generator, advancing it. */
export function roll(world: World): number {
  const drawn = random(world.rng);
  world.rng = drawn.next;
  return drawn.value;
}

/** An item from `pool` that `taken` does not have yet, when there is one. */
function drawUnused<T>(world: World, pool: readonly T[], taken: T[]): T {
  const free = pool.filter((item) => !taken.includes(item));
  const from = free.length > 0 ? free : pool;
  return from[Math.floor(roll(world) * from.length)] as T;
}

function newBoneco(world: World, id: string, sessionId: string | null): Boneco {
  const taken = world.bonecos.map((boneco) => boneco.name);
  let name = drawUnused(world, NAMES, taken);
  if (taken.includes(name)) {
    name = `${name} ${taken.filter((other) => other.startsWith(name)).length + 1}`;
  }
  const looks = Array.from({ length: LOOKS }, (_, index) => index);
  const look = drawUnused(
    world,
    looks,
    world.bonecos.map((boneco) => boneco.look)
  );
  const x = 10 + roll(world) * (world.map.width - 20);
  const y = 10 + roll(world) * (world.map.height - 20);
  return {
    id,
    name,
    look,
    instrument: null,
    sessionId,
    assignedModel: leastUsedModel(world.models, world.bonecos),
    blocoId: null,
    vote: null,
    x,
    y,
    facing: "down",
    target: null,
    speech: null,
    pending: null,
    restUntilMs: 0,
    brain: null,
    model: null,
    decisions: 0,
    ask: null,
    asks: 0,
    interview: sessionId === null ? null : startInterview(),
    personality: null,
    thoughts: [],
  };
}

/** The model with the fewest bonecos, so models are spread evenly. */
function leastUsedModel(models: string[], bonecos: Boneco[]): string | null {
  let best: string | null = null;
  let bestCount = Number.POSITIVE_INFINITY;
  for (const model of models) {
    const count = bonecos.filter(
      (boneco) => boneco.assignedModel === model
    ).length;
    if (count < bestCount) {
      best = model;
      bestCount = count;
    }
  }
  return best;
}

function nextBonecoId(world: World): string {
  const highest = world.bonecos.reduce(
    (max, boneco) => Math.max(max, Number(ID_NUMBER.exec(boneco.id)?.[1] ?? 0)),
    0
  );
  return `boneco-${highest + 1}`;
}

export function createWorld(options: {
  bonecos: number;
  map?: WorldMap;
  rules?: Partial<WorldRules>;
  seed: number;
}): World {
  const world: World = {
    blocos: [],
    bonecos: [],
    events: [],
    formar: null,
    map: options.map ?? PRACA,
    models: [],
    phase: "entrada",
    rng: seedState(options.seed),
    rules: { ...DEFAULT_RULES, ...options.rules },
    timeMs: 0,
  };
  for (let index = 0; index < options.bonecos; index += 1) {
    world.bonecos.push(newBoneco(world, `boneco-${index + 1}`, null));
  }
  return world;
}

/**
 * A person arriving from the phone. The same session always gets the same
 * boneco back, so a reload resumes where it was.
 */
export function join(
  world: World,
  input: { sessionId: string }
): { bonecoId: string; created: boolean; world: World } {
  const known = world.bonecos.find(
    (other) => other.sessionId === input.sessionId
  );
  if (known) {
    return { world, bonecoId: known.id, created: false };
  }
  const next: World = { ...world, bonecos: [...world.bonecos] };
  const boneco = newBoneco(next, nextBonecoId(next), input.sessionId);
  next.bonecos.push(boneco);
  return { world: next, bonecoId: boneco.id, created: true };
}

export function think(
  boneco: Boneco,
  world: World,
  text: string,
  model: string | null,
  tone: Thought["tone"]
): Boneco {
  const thoughts = [
    ...boneco.thoughts,
    { atMs: world.timeMs, text, model, tone },
  ].slice(-world.rules.thoughtsKept);
  return { ...boneco, thoughts };
}

export function say(boneco: Boneco, world: World, text: string | null): Boneco {
  return {
    ...boneco,
    speech: text
      ? { text, untilMs: world.timeMs + world.rules.speechMs }
      : null,
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

function applyWalk(
  boneco: Boneco,
  world: World,
  action: WalkAction,
  model: string | undefined
): Boneco | undefined {
  const target = world.map.places.find((place) => place.id === action.placeId);
  if (!target) {
    return;
  }
  const text = filterModelText(action.speech, world.rules.speechMaxLength);
  let next: Boneco = {
    ...boneco,
    target,
    pending: null,
    brain: "model",
    model: model ?? null,
  };
  next = say(next, world, text);
  return text ? think(next, world, text, model ?? null, "fala") : next;
}

/** The rule a boneco follows when no brain decides: walk somewhere else. */
function autopilot(boneco: Boneco, world: World): Boneco {
  const here = placeAt(world, boneco);
  const elsewhere = world.map.places.filter((place) => place !== here);
  return {
    ...boneco,
    target: elsewhere[Math.floor(roll(world) * elsewhere.length)] ?? null,
    pending: null,
    brain: "autopilot",
    model: null,
    speech: null,
  };
}

// --- Asking the human ------------------------------------------------------

export function askHuman(
  boneco: Boneco,
  world: World,
  spec: Parameters<typeof openAsk>[0]
): Boneco {
  const asks = boneco.asks + 1;
  return {
    ...boneco,
    asks,
    ask: openAsk(spec, `${boneco.id}?${asks}`, world.timeMs, world.rules),
  };
}

/** What each purpose does with the outcome of an ask. */
const ASK_HANDLERS: Record<
  string,
  (boneco: Boneco, world: World, ask: Ask, outcome: AskOutcome) => Boneco
> = {
  interview: interviewAnswered,
  bloco: blocoAnswered,
};

function closeAsk(boneco: Boneco, world: World, outcome: AskOutcome): Boneco {
  const ask = boneco.ask as Ask;
  let next: Boneco = { ...boneco, ask: null };
  if (outcome.by === "boneco") {
    next = think(next, world, decidedAloneNotice(ask, outcome), null, "aviso");
  }
  const handler = ASK_HANDLERS[ask.purpose];
  return handler ? handler(next, world, ask, outcome) : next;
}

/**
 * A person answering the question their phone shows. Returns the world
 * unchanged and an error when the answer does not fit the current question.
 */
export function answerHuman(
  world: World,
  input: HumanAnswer & { sessionId: string }
): { error?: string; world: World } {
  const index = world.bonecos.findIndex(
    (other) => other.sessionId === input.sessionId
  );
  const boneco = world.bonecos[index];
  if (!boneco) {
    return { world, error: "boneco não encontrado" };
  }
  if (!boneco.ask) {
    return { world, error: "nenhuma pergunta aberta" };
  }
  const result = answerAsk(boneco.ask, input, world.timeMs, world.rules);
  if ("error" in result) {
    return { world, error: result.error };
  }
  const next: World = { ...world, bonecos: [...world.bonecos] };
  next.bonecos[index] =
    "ask" in result
      ? { ...boneco, ask: result.ask }
      : closeAsk(boneco, next, result.outcome);
  return { world: next };
}

// --- The interview ---------------------------------------------------------

function interviewAnswered(
  boneco: Boneco,
  world: World,
  ask: Ask,
  outcome: AskOutcome
): Boneco {
  const { interview } = boneco;
  if (!interview) {
    return boneco;
  }
  if (interview.stage === "tap" && outcome.choice !== null) {
    const answer: InterviewAnswer = {
      question: ask.question,
      answer: ask.options[outcome.choice] as string,
      by: outcome.by,
    };
    const next = recordTap(interview, answer);
    const updated = { ...boneco, interview: next };
    return next.stage === "open" ? askOpenQuestion(updated, world) : updated;
  }
  if (interview.stage === "open") {
    return { ...boneco, interview: recordOpen(interview, outcome.text) };
  }
  return boneco;
}

function askOpenQuestion(boneco: Boneco, world: World): Boneco {
  return askHuman(boneco, world, {
    purpose: "interview",
    question: OPEN_QUESTION,
    options: [],
    textMaxLength: OPEN_TEXT_MAX_LENGTH,
  });
}

function askTap(
  boneco: Boneco,
  world: World,
  question: { options: string[]; question: string },
  model: string | null
): Boneco {
  let next = askHuman(boneco, world, {
    purpose: "interview",
    question: question.question,
    options: question.options,
    model,
  });
  if (model) {
    // Only text a model wrote goes to the balloon on the telão.
    next = say(next, world, question.question);
    next = think(next, world, question.question, model, "fala");
  }
  return next;
}

function askReserve(boneco: Boneco, world: World): Boneco {
  const interview = boneco.interview as Interview;
  const reserve = reserveQuestion(interview, roll(world));
  const next = think(
    { ...boneco, interview: reserve.interview, pending: null },
    world,
    "Meu modelo demorou, então fiz uma pergunta da minha lista.",
    null,
    "aviso"
  );
  return askTap(next, world, reserve, null);
}

function applyQuestion(
  boneco: Boneco,
  world: World,
  action: Action,
  model: string | undefined
): Boneco | undefined {
  if (action.type !== "question") {
    return;
  }
  const question = acceptQuestion(action.question, action.options);
  if (!question) {
    return;
  }
  return askTap(
    { ...boneco, pending: null, brain: "model", model: model ?? null },
    world,
    question,
    model ?? null
  );
}

function finishInterview(
  boneco: Boneco,
  personality: string[],
  instrument: Instrument
): Boneco {
  const interview = boneco.interview as Interview;
  return {
    ...boneco,
    pending: null,
    personality,
    instrument,
    interview: { ...interview, stage: "done" },
  };
}

function applyPersonality(
  boneco: Boneco,
  world: World,
  action: Action,
  model: string | undefined
): Boneco | undefined {
  if (action.type !== "personality") {
    return;
  }
  const personality = acceptPersonality(action.summary);
  if (!personality) {
    return;
  }
  const instrument = isInstrument(action.instrument)
    ? action.instrument
    : drawUnused(world, INSTRUMENTS, []);
  const text = filterModelText(action.speech, world.rules.speechMaxLength);
  let next = finishInterview(
    { ...boneco, brain: "model", model: model ?? null },
    personality,
    instrument
  );
  next = say(next, world, text);
  return text ? think(next, world, text, model ?? null, "fala") : next;
}

function fallbackFinish(boneco: Boneco, world: World): Boneco {
  const interview = boneco.interview as Interview;
  const instrument = drawUnused(world, INSTRUMENTS, []);
  return think(
    finishInterview(boneco, fallbackPersonality(interview), instrument),
    world,
    `Meu modelo demorou, então escolhi sozinho: vou de ${instrument}.`,
    null,
    "aviso"
  );
}

function interviewRequest(
  boneco: Boneco,
  world: World
): DecisionRequest | undefined {
  const { interview } = boneco;
  if (!interview || boneco.ask) {
    return;
  }
  const base = {
    id: `${boneco.id}#${boneco.decisions + 1}`,
    boneco: { id: boneco.id, name: boneco.name },
    deadlineMs: world.timeMs + world.rules.interviewThinkMs,
    model: boneco.assignedModel,
  };
  const answered = interview.answers.map(({ question, answer }) => ({
    question,
    answer,
  }));
  if (interview.stage === "tap") {
    return {
      ...base,
      kind: "question",
      index: interview.answers.length,
      total: TAP_QUESTIONS,
      previous: answered,
    };
  }
  if (interview.stage === "personality") {
    return {
      ...base,
      kind: "personality",
      answers: answered,
      freeText: interview.freeText,
      instruments: INSTRUMENTS,
    };
  }
}

function inInterview(boneco: Boneco): boolean {
  return boneco.interview !== null && boneco.interview.stage !== "done";
}

// --- The step --------------------------------------------------------------

function pendingKind(boneco: Boneco): DecisionKind {
  return boneco.pending ? boneco.pending.kind : "walk";
}

function applyAnswer(
  boneco: Boneco,
  world: World,
  answer: Extract<BrainResult, { ok: true }>
): Boneco | undefined {
  const kind = pendingKind(boneco);
  if (kind === "question") {
    return applyQuestion(boneco, world, answer.action, answer.model);
  }
  if (kind === "personality") {
    return applyPersonality(boneco, world, answer.action, answer.model);
  }
  return answer.action.type === "walk"
    ? applyWalk(boneco, world, answer.action, answer.model)
    : undefined;
}

/** What a boneco does when its brain failed or took too long. */
function fallback(boneco: Boneco, world: World): Boneco {
  const kind = pendingKind(boneco);
  if (kind === "question") {
    return askReserve(boneco, world);
  }
  if (kind === "personality") {
    return fallbackFinish(boneco, world);
  }
  return autopilot(boneco, world);
}

function walkRequest(boneco: Boneco, world: World): WalkRequest {
  return {
    id: `${boneco.id}#${boneco.decisions + 1}`,
    boneco: { id: boneco.id, name: boneco.name },
    deadlineMs: world.timeMs + world.rules.decisionTimeoutMs,
    model: boneco.assignedModel,
    placeId: placeAt(world, boneco)?.id ?? null,
    places: world.map.places,
  };
}

function nextRequest(
  boneco: Boneco,
  world: World
): DecisionRequest | undefined {
  if (boneco.pending || boneco.ask) {
    return;
  }
  if (inInterview(boneco)) {
    return interviewRequest(boneco, world);
  }
  if (
    !boneco.target &&
    world.timeMs >= boneco.restUntilMs &&
    canWander(boneco, world)
  ) {
    return walkRequest(boneco, world);
  }
}

/** Gives a model to every boneco that has none yet, keeping the spread even. */
function assignModels(bonecos: Boneco[], world: World): Boneco[] {
  if (world.models.length === 0) {
    return bonecos;
  }
  const assigned = [...bonecos];
  for (const [index, boneco] of assigned.entries()) {
    if (boneco.assignedModel === null) {
      assigned[index] = {
        ...boneco,
        assignedModel: leastUsedModel(world.models, assigned),
      };
    }
  }
  return assigned;
}

function stepBoneco(
  previous: Boneco,
  world: World,
  results: Map<string, BrainResult>,
  elapsedMs: number
): { boneco: Boneco; request?: DecisionRequest } {
  let boneco = previous;
  // Decisions of the formar phase are settled by `stepFormar`.
  const answer =
    boneco.pending && !holdsDecision(boneco.pending.kind)
      ? results.get(boneco.pending.requestId)
      : undefined;
  if (answer?.ok) {
    boneco = applyAnswer(boneco, world, answer) ?? boneco;
  }
  // Still waiting: a failed or unusable answer, or the deadline, ends it.
  if (
    boneco.pending &&
    !holdsDecision(boneco.pending.kind) &&
    (answer || world.timeMs >= boneco.pending.deadlineMs)
  ) {
    boneco = fallback(boneco, world);
  }
  if (boneco.ask && world.timeMs >= boneco.ask.deadlineMs) {
    boneco = closeAsk(boneco, world, decideAlone(boneco.ask, roll(world)));
  }
  boneco = move(boneco, world, elapsedMs);
  const request = nextRequest(boneco, world);
  if (!request) {
    return { boneco };
  }
  return {
    request,
    boneco: {
      ...boneco,
      decisions: boneco.decisions + 1,
      pending: {
        requestId: request.id,
        deadlineMs: request.deadlineMs,
        kind: request.kind ?? "walk",
        sinceMs: world.timeMs,
      },
    },
  };
}

export function step(
  world: World,
  input: { elapsedMs: number; models?: string[]; results?: BrainResult[] }
): { requests: DecisionRequest[]; world: World } {
  const next: World = {
    ...world,
    timeMs: world.timeMs + input.elapsedMs,
    models: input.models ? [...new Set(input.models)].sort() : world.models,
  };
  const results = new Map(
    (input.results ?? []).map((result) => [result.requestId, result])
  );
  const requests: DecisionRequest[] = [];
  next.bonecos = assignModels(world.bonecos, next).map((previous) => {
    const stepped = stepBoneco(previous, next, results, input.elapsedMs);
    if (stepped.request) {
      requests.push(stepped.request);
    }
    return stepped.boneco;
  });
  const formed = stepFormar(next, results);
  return { world: formed.world, requests: [...requests, ...formed.requests] };
}

// --- Views -----------------------------------------------------------------

function publicBoneco(world: World, boneco: Boneco): PublicBoneco {
  return {
    id: boneco.id,
    name: boneco.name,
    look: boneco.look,
    instrument: boneco.instrument,
    x: boneco.x,
    y: boneco.y,
    facing: boneco.facing,
    walking: boneco.target !== null,
    thinking: boneco.pending !== null,
    thinkingForMs: boneco.pending
      ? world.timeMs - boneco.pending.sinceMs
      : null,
    asking: boneco.ask !== null,
    bloco: boneco.blocoId,
    speech:
      boneco.speech && boneco.speech.untilMs > world.timeMs
        ? boneco.speech.text
        : null,
    brain: boneco.brain,
    assignedModel: boneco.assignedModel,
    model: boneco.model,
  };
}

export function publicSnapshot(world: World): PublicSnapshot {
  return {
    timeMs: world.timeMs,
    phase: world.phase,
    map: world.map,
    bonecos: world.bonecos.map((boneco) => publicBoneco(world, boneco)),
    blocos: world.blocos.map(({ id, mark, members, spot }) => ({
      id,
      mark,
      members,
      spot,
    })),
    events: world.events,
  };
}

/** A boneco as another person's phone shows it. */
export function mateOf(boneco: Boneco): Mate {
  return {
    id: boneco.id,
    name: boneco.name,
    look: boneco.look,
    instrument: boneco.instrument,
  };
}

function blocoOf(world: World, boneco: Boneco): PrivateView["bloco"] {
  const bloco = world.blocos.find((other) => other.id === boneco.blocoId);
  if (!bloco) {
    return null;
  }
  const mates = bloco.members.flatMap((id) => {
    const mate = world.bonecos.find((other) => other.id === id);
    return mate && mate.id !== boneco.id ? [mateOf(mate)] : [];
  });
  return { id: bloco.id, mark: bloco.mark, mates };
}

/** One person's phone, by session; null for a session the world does not know. */
export function privateView(
  world: World,
  sessionId: string
): PrivateView | null {
  const boneco = world.bonecos.find((other) => other.sessionId === sessionId);
  if (!boneco) {
    return null;
  }
  const { ask, interview } = boneco;
  return {
    timeMs: world.timeMs,
    phase: world.phase,
    boneco: {
      ...publicBoneco(world, boneco),
      assignedModel: boneco.assignedModel,
      personality: boneco.personality,
    },
    thoughts: boneco.thoughts,
    talks: talksOf(world, boneco.id),
    bloco: blocoOf(world, boneco),
    ask: ask
      ? {
          id: ask.id,
          question: ask.question,
          options: ask.options,
          textMaxLength: ask.textMaxLength,
          remainingMs: Math.max(0, ask.deadlineMs - world.timeMs),
          totalMs: world.rules.askMs,
        }
      : null,
    interview: interview
      ? {
          answered: interview.answers.length,
          total: TAP_QUESTIONS,
          done: interview.stage === "done",
        }
      : null,
  };
}
