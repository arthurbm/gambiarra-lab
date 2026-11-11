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
  acceptHumanName,
  type ComporState,
  type ComposeView,
  composeView,
  holdsComposeDecision,
  stepCompor,
  VOTE_PURPOSE,
  votoAnswered,
} from "./compor";
import type { DesfileState } from "./desfile";
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
export type { ComporState, ComposeView } from "./compor";
export type { DesfileState } from "./desfile";
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
/** The phases that run on a clock; the entrance and the final wait for the host. */
export type TimedPhase = "compor" | "desfile" | "formar";
export type PhaseDurations = Record<TimedPhase, number>;
export const DEFAULT_PHASE_DURATIONS: PhaseDurations = {
  formar: 150_000,
  compor: 150_000,
  desfile: 180_000,
};

/** The phase's clock. Only `sim/phases.ts` moves it. */
export interface PhaseClock {
  durations: PhaseDurations;
  /** Time the current phase has run, not counting pauses. */
  elapsedMs: number;
  paused: boolean;
}

/** How many looks the art has; a boneco's look is an index into them. */
export const LOOKS = 30;

/** Whether `value` is a look the art has: a whole number from 0 to LOOKS - 1. */
export function isLook(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value < LOOKS
  );
}

/** The looks the square's bonecos wear, in order; a new boneco avoids them. */
export function looksInUse(world: World): number[] {
  return [...new Set(world.bonecos.map((boneco) => boneco.look))].sort(
    (a, b) => a - b
  );
}

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
  blocos: string[][];
  speech: string;
  type: "maestro";
}
/** A name for the boneco's bloco. */
export interface NameAction {
  name: string;
  type: "nome";
}
/** A refrain of two to four verses about what the bloco's humans share. */
export interface RefrainAction {
  /** What the humans have in common, in the model's words. */
  common: string;
  lines: string[];
  type: "refrao";
}
export type Action =
  | EncounterAction
  | MaestroAction
  | NameAction
  | RefrainAction
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
  /**
   * Bonecos without a bloco at or walking to each place, by place id, not
   * counting the one asking, so the model can avoid the crowded ones.
   */
  crowd?: Record<string, number>;
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

/** A boneco proposes a name for its bloco. */
export interface NameRequest extends RequestBase {
  kind: "nome";
  /** Everyone in the bloco, the boneco itself included. */
  people: Acquaintance[];
  /** Names other blocos already have, to avoid. */
  taken: string[];
}

/** A boneco proposes the bloco's refrain, or a reworked one. */
export interface RefrainRequest extends RequestBase {
  blocoName: string;
  /** The refrain the bloco chose, when this is the round to rework it. */
  current: string[] | null;
  kind: "refrao";
  /** Everyone in the bloco, the boneco itself included. */
  people: Acquaintance[];
}

/** A decision the simulation wants from a brain before `deadlineMs`. */
export type DecisionRequest =
  | EncounterRequest
  | MaestroRequest
  | NameRequest
  | RefrainRequest
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
  /**
   * The human's vote in the bloco's current round, until the round reads it;
   * `text` is a name the human wrote instead of picking one.
   */
  ballot: { askId: string; choice: number | null; text?: string | null } | null;
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
  /** The host hid what it says from the telão. */
  silenced: boolean;
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
  /** The boneco whose own line this is; hidden while it is silenced. */
  bonecoId?: string;
  id: number;
  text: string;
}

export interface WorldRules {
  /** Countdown of a question a boneco asks its human, unless it has its own. */
  askMs: number;
  /**
   * Typing in an open question never stretches its wait past this. At or
   * below `openAskMs`, typing never stretches an open answer at all.
   */
  askTypingCapMs: number;
  /** How long a boneco waits for its brain before going on autopilot. */
  decisionTimeoutMs: number;
  /** Events the telão's log keeps. */
  eventsKept: number;
  /** Countdown of each tap question of the interview: people read it on arrival. */
  interviewAskMs: number;
  /** How long the interview waits for the model before a fixed question. */
  interviewThinkMs: number;
  /** How long the maestro may think before the square groups by distance. */
  maestroMs: number;
  /** Bonecos the square holds; a person arriving when it is full is turned away. */
  maxBonecos: number;
  /** The same two bonecos meet again only after this long. */
  meetCooldownMs: number;
  /** Two bonecos this close (in map units) meet. */
  meetRadius: number;
  /**
   * Countdown of a question the person may answer by writing: the interview's
   * open question and the vote on the bloco's name.
   */
  openAskMs: number;
  /** Pause at a place before the next decision. */
  restMs: number;
  speechMaxLength: number;
  speechMs: number;
  /** Map units per second. */
  speed: number;
  thoughtsKept: number;
  /** Countdown of a vote with choices only: the refrain and its rework. */
  voteMs: number;
}

export interface World {
  blocos: Bloco[];
  bonecos: Boneco[];
  /** The compor phase's rounds and votes; null before it starts. */
  compor: ComporState | null;
  /** The desfile's bloco on stage and the host's choices; null before it starts. */
  desfile: DesfileState | null;
  events: WorldEvent[];
  /** The formar phase's encounters and proposals; null before it starts. */
  formar: FormarState | null;
  map: WorldMap;
  /** The models of the Room, for spreading bonecos evenly among them. */
  models: string[];
  phase: Phase;
  phaseClock: PhaseClock;
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
  /** Chosen in the compor phase; null until then. */
  name: string | null;
  /** One verse per item, two to four; null until chosen. */
  refrain: string[] | null;
  /** Where the bloco gathers; `id` is the meeting spot's, on the square. */
  spot: { id: string | null; x: number; y: number };
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
    /** What the question is for: "interview", "bloco" or "voto". */
    purpose: string;
    question: string;
    /** Left on the countdown, so the phone does not depend on its clock. */
    remainingMs: number;
    /** With options too, the human may write another one instead of picking. */
    textMaxLength: number | null;
    totalMs: number;
  } | null;
  /** The boneco's bloco and the others in it. */
  bloco: { id: string; mark: number; mates: Mate[] } | null;
  boneco: PublicBoneco & {
    assignedModel: string | null;
    personality: string[] | null;
  };
  /** The bloco's name and refrain rounds, the same on every phone of the bloco. */
  compor: ComposeView | null;
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
  interviewAskMs: 30_000,
  interviewThinkMs: 8000,
  maestroMs: 10_000,
  maxBonecos: 30,
  meetCooldownMs: 30_000,
  meetRadius: 8,
  openAskMs: 60_000,
  restMs: 1500,
  speechMaxLength: 140,
  speechMs: 6000,
  speed: 14,
  thoughtsKept: 8,
  voteMs: 25_000,
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
  "Seu Zé",
  "Docinho",
  "Manga",
  "Frevinho",
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

/** Longest name a person may give their boneco; it is drawn under it on the telão. */
export const PERSON_NAME_MAX_LENGTH = 16;

/**
 * The name a person typed on arrival, as the telão may show it: one line,
 * through the same filter as model text. Null when empty, too long or blocked.
 */
export function acceptPersonName(name: unknown): string | null {
  if (typeof name !== "string") {
    return null;
  }
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean.length > PERSON_NAME_MAX_LENGTH) {
    return null;
  }
  return filterModelText(clean, PERSON_NAME_MAX_LENGTH);
}

function newBoneco(
  world: World,
  id: string,
  sessionId: string | null,
  chosenName?: string | null,
  chosenLook?: number | null
): Boneco {
  const taken = world.bonecos.map((boneco) => boneco.name);
  const lower = (text: string) => text.toLocaleLowerCase("pt-BR");
  const base = chosenName ?? drawUnused(world, NAMES, taken);
  let name = base;
  // Two people may ask for the same name: the second is "Ana 2".
  for (let count = 2; taken.some((other) => lower(other) === lower(name)); ) {
    name = `${base} ${count}`;
    count += 1;
  }
  const looks = Array.from({ length: LOOKS }, (_, index) => index);
  const look = chosenLook ?? drawUnused(world, looks, looksInUse(world));
  const x = 10 + roll(world) * (world.map.width - 20);
  const y = 10 + roll(world) * (world.map.height - 20);
  return {
    id,
    name,
    look,
    instrument: null,
    sessionId,
    assignedModel: leastUsedModel(world.models, world.bonecos),
    ballot: null,
    blocoId: null,
    vote: null,
    x,
    y,
    facing: "down",
    target: null,
    speech: null,
    pending: null,
    restUntilMs: 0,
    silenced: false,
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
    compor: null,
    desfile: null,
    events: [],
    formar: null,
    map: options.map ?? PRACA,
    models: [],
    phase: "entrada",
    phaseClock: {
      elapsedMs: 0,
      paused: false,
      durations: { ...DEFAULT_PHASE_DURATIONS },
    },
    rng: seedState(options.seed),
    rules: { ...DEFAULT_RULES, ...options.rules },
    timeMs: 0,
  };
  for (let index = 0; index < options.bonecos; index += 1) {
    world.bonecos.push(newBoneco(world, `boneco-${index + 1}`, null));
  }
  return world;
}

export type JoinResult =
  | { bonecoId: string; created: boolean; full: false; world: World }
  | { bonecoId: null; created: false; full: true; world: World };

/** The square holds `rules.maxBonecos`; nobody new joins once it does. */
export function squareFull(world: World): boolean {
  return world.bonecos.length >= world.rules.maxBonecos;
}

/**
 * A person arriving from the phone. The same session always gets the same
 * boneco back, so a reload resumes where it was, even with the square full.
 * `name` is what the person asked to be called (already through
 * `acceptPersonName`); without it the boneco gets a drawn name. `look` is the
 * character the person picked (already checked with `isLook` and against
 * `looksInUse`); without it the boneco gets a drawn one not in use.
 */
export function join(
  world: World,
  input: { look?: number | null; name?: string | null; sessionId: string }
): JoinResult {
  const known = world.bonecos.find(
    (other) => other.sessionId === input.sessionId
  );
  if (known) {
    return { world, bonecoId: known.id, created: false, full: false };
  }
  if (squareFull(world)) {
    return { world, bonecoId: null, created: false, full: true };
  }
  const next: World = { ...world, bonecos: [...world.bonecos] };
  const boneco = newBoneco(
    next,
    nextBonecoId(next),
    input.sessionId,
    input.name,
    input.look
  );
  next.bonecos.push(boneco);
  return { world: next, bonecoId: boneco.id, created: true, full: false };
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

/**
 * Bonecos without a bloco at or walking to each place, other than `self`: the
 * ones a boneco could still meet there. A boneco in a bloco is out of the
 * meetings, so it does not count.
 */
function crowdOf(world: World, self: Boneco): Record<string, number> {
  const crowd: Record<string, number> = Object.fromEntries(
    world.map.places.map((place) => [place.id, 0])
  );
  for (const boneco of world.bonecos) {
    if (boneco.id === self.id || boneco.blocoId !== null) {
      continue;
    }
    const place = boneco.target ?? placeAt(world, boneco);
    if (place && place.id in crowd) {
      crowd[place.id] = (crowd[place.id] ?? 0) + 1;
    }
  }
  return crowd;
}

/**
 * The rule a boneco follows when no brain decides: walk somewhere else, to one
 * of the least crowded places, so the square does not pile up in one spot.
 */
function autopilot(boneco: Boneco, world: World): Boneco {
  const here = placeAt(world, boneco);
  const crowd = crowdOf(world, boneco);
  const others = world.map.places.filter((place) => place !== here);
  const fewest = Math.min(...others.map((place) => crowd[place.id] ?? 0));
  const elsewhere = others.filter((place) => (crowd[place.id] ?? 0) === fewest);
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
  voto: votoAnswered,
};

/**
 * Text a human writes for an ask of this purpose reaches the telão, so it is
 * checked on the way in: the clean text, or null to refuse the answer.
 */
const ASK_TEXT_CHECKS: Record<string, (text: string) => string | null> = {
  voto: acceptHumanName,
};

function closeAsk(boneco: Boneco, world: World, outcome: AskOutcome): Boneco {
  const ask = boneco.ask as Ask;
  let next: Boneco = { ...boneco, ask: null };
  // A vote has its own notice: the boneco does not vote for its human.
  if (outcome.by === "boneco" && ask.purpose !== VOTE_PURPOSE) {
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
  if ("ask" in result) {
    next.bonecos[index] = { ...boneco, ask: result.ask };
    return { world: next };
  }
  let { outcome } = result;
  const check = ASK_TEXT_CHECKS[boneco.ask.purpose];
  if (check && typeof input.text === "string") {
    // The text as written: a name over the limit is refused, not cut.
    const text = check(input.text);
    if (!text) {
      return {
        world,
        error: "Esse nome não pode ir para o telão. Tente outro.",
      };
    }
    outcome = { ...outcome, text };
  }
  next.bonecos[index] = closeAsk(boneco, next, outcome);
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
    // Writing takes longer than tapping: a minute.
    durationMs: world.rules.openAskMs,
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
    durationMs: world.rules.interviewAskMs,
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
    crowd: crowdOf(world, boneco),
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

/** Decisions a phase module settles itself, instead of the boneco's step. */
function held(kind: DecisionKind): boolean {
  return holdsDecision(kind) || holdsComposeDecision(kind);
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
    boneco.pending && !held(boneco.pending.kind)
      ? results.get(boneco.pending.requestId)
      : undefined;
  if (answer?.ok) {
    boneco = applyAnswer(boneco, world, answer) ?? boneco;
  }
  // Still waiting: a failed or unusable answer, or the deadline, ends it.
  if (
    boneco.pending &&
    !held(boneco.pending.kind) &&
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
  const composed = stepCompor(formed.world, results);
  return {
    world: composed.world,
    requests: [...requests, ...formed.requests, ...composed.requests],
  };
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
      boneco.speech && boneco.speech.untilMs > world.timeMs && !boneco.silenced
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
    blocos: world.blocos.map(({ id, mark, members, spot, name, refrain }) => ({
      id,
      mark,
      members,
      spot,
      name,
      refrain,
    })),
    events: world.events.filter((event) => !silenced(world, event.bonecoId)),
  };
}

function silenced(world: World, bonecoId: string | undefined): boolean {
  return (
    bonecoId !== undefined &&
    world.bonecos.some((boneco) => boneco.id === bonecoId && boneco.silenced)
  );
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
    compor: composeView(world, boneco),
    ask: ask
      ? {
          id: ask.id,
          purpose: ask.purpose,
          question: ask.question,
          options: ask.options,
          textMaxLength: ask.textMaxLength,
          remainingMs: Math.max(0, ask.deadlineMs - world.timeMs),
          totalMs: ask.totalMs,
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
