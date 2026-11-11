// The formar phase: bonecos walk the square, two without a bloco that come
// close meet (one line each and whether their humans match), a boneco that
// matched two others without a bloco invites them, each human confirms with a
// tap, and a bloco closes with exactly three. When the phase ends the maestro,
// one model call with every personality left, groups whoever is still alone;
// if it fails, the square groups them by distance. Whoever arrives later goes
// to the smallest bloco.
//
// The world calls `stepFormar` on every step; `enterFormar` and `closeFormar`
// are the phase's hooks (wired in `phases.ts`), and `leaveFormar` runs when
// the host expels a boneco.
import { BONECO_REMOVED_HOOKS } from "./admin";
import type { Ask, AskOutcome } from "./ask";
import { filterModelText } from "./blocklist";
import { logEvent } from "./events";
import { MEETING_SPOTS } from "./meeting-spots";
import {
  type Acquaintance,
  askHuman,
  type Boneco,
  type BrainResult,
  type DecisionKind,
  type DecisionRequest,
  type EncounterRequest,
  type Facing,
  type MaestroRequest,
  mateOf,
  type Place,
  PRACA,
  say,
  type Talk,
  think,
  type World,
} from "./world";

export interface Bloco {
  /** How it was made: an invitation, the maestro, distance, or a late arrival. */
  formedBy: "atraso" | "convite" | "maestro" | "proximidade";
  id: string;
  /** Index of the bloco's colour or mark, in formation order. */
  mark: number;
  /** Boneco ids. */
  members: string[];
  /** Where the bloco gathers; `id` is the meeting spot's, on the square. */
  spot: { id: string | null; x: number; y: number };
}

interface EncounterSide {
  deadlineMs: number;
  done: boolean;
  id: string;
  liked: boolean | null;
  line: string | null;
  requestId: string;
}

interface Encounter {
  atMs: number;
  /** When both sides finished; null while one still thinks. */
  closedAtMs: number | null;
  sides: [EncounterSide, EncounterSide];
}

interface Proposal {
  /** The ask each human got, by boneco id; simulated bonecos get none. */
  askIds: Record<string, string>;
  by: string;
  id: string;
  members: string[];
  votes: Record<string, boolean>;
}

interface Maestro {
  deadlineMs: number;
  leftovers: string[];
  requestId: string | null;
  sizes: number[];
  state: "done" | "pending" | "wanted";
}

export interface FormarState {
  /** Boneco id → the ids it declared affinity with, oldest first. */
  affinity: Record<string, string[]>;
  /** Blocos made so far, emptied ones included: marks are never reused. */
  blocosMade: number;
  encounters: Encounter[];
  /** Pair key → when the two last met. */
  lastMetMs: Record<string, number>;
  maestro: Maestro | null;
  /** Encounters and invitations happen only while the phase is open. */
  open: boolean;
  proposals: Proposal[];
  proposalsMade: number;
  /** Trios whose invitation was turned down, so it is not repeated. */
  refused: string[];
}

const YES = "Bora!";
const NO = "Agora não";
const TALKS_SHOWN = 6;
/** Where blocos gather, as fractions of the map; used in turns. */
const GATHERING = [
  [0.3, 0.3],
  [0.7, 0.3],
  [0.5, 0.55],
  [0.15, 0.75],
  [0.85, 0.75],
  [0.35, 0.85],
  [0.65, 0.85],
  [0.1, 0.35],
  [0.9, 0.35],
  [0.5, 0.15],
] as const;
/** Map units between bonecos standing at their bloco's spot. */
const BLOCO_SPACING = 5;

// --- Hooks the world and the phase clock call -------------------------------

/** The formar phase begins: encounters and invitations open. */
export function enterFormar(world: World): World {
  if (world.formar?.open) {
    return world;
  }
  return logEvent(
    {
      ...world,
      phase: "formar",
      formar: world.formar ?? {
        open: true,
        encounters: [],
        lastMetMs: {},
        affinity: {},
        proposals: [],
        proposalsMade: 0,
        blocosMade: 0,
        refused: [],
        maestro: null,
      },
    },
    "Hora de formar os blocos! Os bonecos vão se conhecer."
  );
}

/**
 * The formar phase ends. Invitations still waiting are decided, with
 * whoever did not answer counting as yes; encounters stop; and whoever is
 * left without a bloco is grouped: by the maestro on the next steps when
 * there is more than one bloco to make, at once otherwise. It does not change
 * the phase; the phase clock does.
 */
export function closeFormar(world: World): World {
  if (!world.formar?.open) {
    return world;
  }
  const draft = edit(world);
  const formar = draft.formar as FormarState;
  formar.open = false;
  for (const proposal of formar.proposals) {
    collectVotes(draft, proposal);
    for (const id of proposal.members) {
      proposal.votes[id] ??= true;
    }
    decide(draft, proposal, true);
  }
  formar.proposals = [];
  cancelEncounters(draft);

  const leftovers = draft.bonecos.filter((boneco) => boneco.blocoId === null);
  const sizes = sizesFor(leftovers.length);
  if (leftovers.length === 0 || sizes.length === 1) {
    if (leftovers.length > 1 || draft.blocos.length === 0) {
      note(draft, "Acabou a roda. Quem ficou sem bloco forma um juntos.");
      formBloco(
        draft,
        leftovers.map((boneco) => boneco.id),
        "proximidade"
      );
    }
    formar.maestro = done();
    return draft;
  }
  formar.maestro = {
    state: "wanted",
    leftovers: leftovers.map((boneco) => boneco.id),
    sizes,
    requestId: null,
    deadlineMs: 0,
  };
  note(draft, "Acabou a roda. O maestro vai juntar quem ficou sem bloco.");
  return draft;
}

/**
 * A boneco left the world (the host expelled it): it leaves its bloco (an
 * empty bloco goes away), invitations with it are called off for the others,
 * and the maestro no longer counts it.
 */
export function leaveFormar(world: World, bonecoId: string): World {
  const inBloco = world.blocos.some((bloco) =>
    bloco.members.includes(bonecoId)
  );
  if (!(inBloco || world.formar)) {
    return world;
  }
  const draft = edit(world);
  draft.blocos = draft.blocos.flatMap((bloco) => {
    const members = bloco.members.filter((id) => id !== bonecoId);
    return members.length > 0 ? [{ ...bloco, members }] : [];
  });
  const { formar } = draft;
  if (!formar) {
    return draft;
  }
  formar.proposals = formar.proposals.filter((proposal) => {
    if (!proposal.members.includes(bonecoId)) {
      return true;
    }
    closeAsks(draft, proposal);
    for (const id of proposal.members) {
      const boneco = find(draft, id);
      if (boneco) {
        put(
          draft,
          think(
            { ...boneco, vote: null },
            draft,
            "O convite caiu: alguém saiu da praça. Sigo procurando.",
            null,
            "aviso"
          )
        );
      }
    }
    return false;
  });
  const { maestro } = formar;
  if (maestro?.leftovers.includes(bonecoId)) {
    const leftovers = maestro.leftovers.filter((id) => id !== bonecoId);
    formar.maestro = {
      ...maestro,
      leftovers,
      sizes:
        maestro.state === "wanted" ? sizesFor(leftovers.length) : maestro.sizes,
    };
  }
  return draft;
}

BONECO_REMOVED_HOOKS.push(leaveFormar);

/** Decisions the world leaves to this module instead of settling them. */
export function holdsDecision(kind: DecisionKind): boolean {
  return kind === "encounter";
}

/**
 * Whether the boneco may ask its brain where to walk: not while it is in a
 * bloco, waiting on an invitation or waiting for the maestro.
 */
export function canWander(boneco: Boneco, world: World): boolean {
  if (boneco.blocoId !== null) {
    return false;
  }
  const { formar } = world;
  if (!formar) {
    return true;
  }
  if (formar.proposals.some((p) => p.members.includes(boneco.id))) {
    return false;
  }
  return !(
    formar.maestro &&
    formar.maestro.state !== "done" &&
    formar.maestro.leftovers.includes(boneco.id)
  );
}

/** The ask handler for a bloco invitation: the boneco keeps the answer. */
export function blocoAnswered(
  boneco: Boneco,
  _world: World,
  ask: Ask,
  outcome: AskOutcome
): Boneco {
  return { ...boneco, vote: { askId: ask.id, yes: outcome.choice === 0 } };
}

/** The boneco's encounters, oldest first, as its phone shows them. */
export function talksOf(world: World, bonecoId: string): Talk[] {
  const talks: Talk[] = [];
  for (const encounter of world.formar?.encounters ?? []) {
    const mine = encounter.sides.find((side) => side.id === bonecoId);
    const theirs = encounter.sides.find((side) => side.id !== bonecoId);
    const other = theirs && find(world, theirs.id);
    if (mine && theirs && other) {
      talks.push({
        atMs: encounter.atMs,
        with: mateOf(other),
        mine: mine.line,
        theirs: theirs.line,
        liked: mine.liked,
      });
    }
  }
  return talks.slice(-TALKS_SHOWN);
}

/**
 * Where a bloco gathers: on the square, the map's meeting spots in turn (the
 * telão draws a flag at each); on any other map, spots spread over it.
 */
export function blocoSpot(
  world: World,
  mark: number
): { id: string | null; x: number; y: number } {
  const onSquare =
    world.map.width === PRACA.width && world.map.height === PRACA.height;
  const meeting = MEETING_SPOTS[mark % MEETING_SPOTS.length];
  if (onSquare && meeting) {
    return { id: meeting.id, x: meeting.x, y: meeting.y };
  }
  const [fx, fy] = GATHERING[mark % GATHERING.length] as readonly [
    number,
    number,
  ];
  return {
    id: null,
    x: Math.round(world.map.width * fx),
    y: Math.round(world.map.height * fy),
  };
}

/**
 * The sizes of the blocos to make with `count` bonecos: threes, with one bloco
 * of four or two when the count is not a multiple of three.
 */
export function sizesFor(count: number): number[] {
  if (count <= 0) {
    return [];
  }
  if (count <= 4) {
    return [count];
  }
  const threes = Math.floor(count / 3);
  const rest = count % 3;
  if (rest === 1) {
    return [...Array.from({ length: threes - 1 }, () => 3), 4];
  }
  return [
    ...Array.from({ length: threes }, () => 3),
    ...(rest === 2 ? [2] : []),
  ];
}

// --- The step ---------------------------------------------------------------

/** One step of the formar phase, after the bonecos moved. */
export function stepFormar(
  world: World,
  results: Map<string, BrainResult>
): { requests: DecisionRequest[]; world: World } {
  if (!world.formar) {
    return { world, requests: [] };
  }
  const draft = edit(world);
  const formar = draft.formar as FormarState;
  const requests: DecisionRequest[] = [];
  settleEncounters(draft, results);
  if (formar.open) {
    invite(draft);
    settleProposals(draft);
    requests.push(...startEncounters(draft));
  } else {
    const request = runMaestro(draft, results);
    if (request) {
      requests.push(request);
    }
    if (formar.maestro?.state === "done") {
      placeLate(draft);
    }
  }
  return { world: draft, requests };
}

// --- Drafts -----------------------------------------------------------------

/** A copy of the world this module may change in place. */
function edit(world: World): World {
  return {
    ...world,
    bonecos: [...world.bonecos],
    blocos: world.blocos.map((bloco) => ({
      ...bloco,
      members: [...bloco.members],
    })),
    formar: world.formar ? structuredClone(world.formar) : null,
  };
}

function find(world: World, id: string): Boneco | undefined {
  return world.bonecos.find((boneco) => boneco.id === id);
}

function get(world: World, id: string): Boneco {
  const boneco = find(world, id);
  if (!boneco) {
    throw new Error(`no boneco ${id}`);
  }
  return boneco;
}

function put(world: World, boneco: Boneco) {
  const index = world.bonecos.findIndex((other) => other.id === boneco.id);
  world.bonecos[index] = boneco;
}

function note(world: World, text: string) {
  world.events = logEvent(world, text).events;
}

function done(): Maestro {
  return {
    state: "done",
    leftovers: [],
    sizes: [],
    requestId: null,
    deadlineMs: 0,
  };
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("+");
}

function trioKey(ids: string[]): string {
  return [...ids].sort().join("+");
}

function names(list: string[]): string {
  if (list.length <= 1) {
    return list.join("");
  }
  return `${list.slice(0, -1).join(", ")} e ${list.at(-1)}`;
}

function acquaintance(boneco: Boneco): Acquaintance {
  return {
    name: boneco.name,
    personality: boneco.personality,
    instrument: boneco.instrument,
  };
}

function facingTo(from: Boneco, to: Boneco): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return from.facing;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

// --- Encounters -------------------------------------------------------------

function inProposal(world: World, id: string): boolean {
  return (world.formar?.proposals ?? []).some((proposal) =>
    proposal.members.includes(id)
  );
}

/** Without a bloco, done with the interview and not busy with anything else. */
function isFree(world: World, boneco: Boneco): boolean {
  return (
    boneco.blocoId === null &&
    boneco.ask === null &&
    boneco.vote === null &&
    (boneco.pending === null || boneco.pending.kind === "walk") &&
    (boneco.interview === null || boneco.interview.stage === "done") &&
    !inProposal(world, boneco.id)
  );
}

function startEncounters(world: World): EncounterRequest[] {
  const formar = world.formar as FormarState;
  const { meetRadius, meetCooldownMs } = world.rules;
  const free = world.bonecos.filter((boneco) => isFree(world, boneco));
  const paired = new Set<string>();
  const requests: EncounterRequest[] = [];
  for (const a of free) {
    if (paired.has(a.id)) {
      continue;
    }
    let best: Boneco | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const b of free) {
      const last = formar.lastMetMs[pairKey(a.id, b.id)];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (
        b.id !== a.id &&
        !paired.has(b.id) &&
        (last === undefined || world.timeMs - last >= meetCooldownMs) &&
        distance <= meetRadius &&
        distance < bestDistance
      ) {
        best = b;
        bestDistance = distance;
      }
    }
    if (best) {
      paired.add(a.id);
      paired.add(best.id);
      requests.push(...meet(world, a, best));
    }
  }
  return requests;
}

function meet(world: World, a: Boneco, b: Boneco): EncounterRequest[] {
  const formar = world.formar as FormarState;
  const first = encounterRequest(world, a, b);
  const second = encounterRequest(world, b, a);
  const requests = [first, second];
  for (const [boneco, other, request] of [
    [a, b, first],
    [b, a, second],
  ] as const) {
    put(world, {
      ...boneco,
      decisions: boneco.decisions + 1,
      target: null,
      facing: facingTo(boneco, other),
      pending: {
        requestId: request.id,
        deadlineMs: request.deadlineMs,
        kind: "encounter",
        sinceMs: world.timeMs,
      },
    });
  }
  formar.lastMetMs[pairKey(a.id, b.id)] = world.timeMs;
  formar.encounters.push({
    atMs: world.timeMs,
    closedAtMs: null,
    sides: requests.map((request) => ({
      id: request.boneco.id,
      requestId: request.id,
      deadlineMs: request.deadlineMs,
      line: null,
      liked: null,
      done: false,
    })) as [EncounterSide, EncounterSide],
  });
  return requests;
}

function encounterRequest(
  world: World,
  boneco: Boneco,
  other: Boneco
): EncounterRequest {
  return {
    kind: "encounter",
    id: `${boneco.id}#${boneco.decisions + 1}`,
    boneco: { id: boneco.id, name: boneco.name },
    deadlineMs: world.timeMs + world.rules.decisionTimeoutMs,
    model: boneco.assignedModel,
    personality: boneco.personality,
    instrument: boneco.instrument,
    other: acquaintance(other),
  };
}

function settleEncounters(world: World, results: Map<string, BrainResult>) {
  const formar = world.formar as FormarState;
  for (const encounter of formar.encounters) {
    if (encounter.closedAtMs !== null) {
      continue;
    }
    for (const side of encounter.sides) {
      if (!side.done) {
        settleSide(world, encounter, side, results.get(side.requestId));
      }
    }
    if (encounter.sides.every((side) => side.done)) {
      finishEncounter(world, encounter);
    }
  }
}

function settleSide(
  world: World,
  encounter: Encounter,
  side: EncounterSide,
  result: BrainResult | undefined
) {
  const boneco = find(world, side.id);
  const otherSide = encounter.sides.find((each) => each !== side);
  const other = otherSide && find(world, otherSide.id);
  if (!(boneco && other) || boneco.pending?.requestId !== side.requestId) {
    // The boneco left, or its encounter was called off.
    side.done = true;
    return;
  }
  if (result?.ok && result.action.type === "encounter") {
    const line = filterModelText(
      result.action.speech,
      world.rules.speechMaxLength
    );
    const model = result.model ?? null;
    let next: Boneco = { ...boneco, pending: null, brain: "model", model };
    next = say(next, world, line);
    if (line) {
      next = think(next, world, line, model, "fala");
    }
    put(world, next);
    side.line = line;
    side.liked = result.action.affinity === true;
    side.done = true;
    return;
  }
  if (result || world.timeMs >= side.deadlineMs) {
    // Autopilot: no line, and the benefit of the doubt.
    put(
      world,
      think(
        { ...boneco, pending: null, brain: "autopilot", model: null },
        world,
        `Meu modelo demorou, mas achei ${other.name} gente boa.`,
        null,
        "aviso"
      )
    );
    side.liked = true;
    side.done = true;
  }
}

function finishEncounter(world: World, encounter: Encounter) {
  const formar = world.formar as FormarState;
  encounter.closedAtMs = world.timeMs;
  const [a, b] = encounter.sides;
  formar.lastMetMs[pairKey(a.id, b.id)] = world.timeMs;
  for (const [side, other] of [
    [a, b],
    [b, a],
  ] as const) {
    const boneco = find(world, side.id);
    if (boneco) {
      put(world, {
        ...boneco,
        restUntilMs: world.timeMs + world.rules.restMs,
      });
    }
    if (side.liked) {
      const liked = formar.affinity[side.id] ?? [];
      formar.affinity[side.id] = [
        ...liked.filter((id) => id !== other.id),
        other.id,
      ];
    }
  }
  const first = find(world, a.id);
  const second = find(world, b.id);
  if (a.liked && b.liked && first && second) {
    note(world, `${first.name} e ${second.name} se deram bem.`);
  }
}

function cancelEncounters(world: World) {
  const formar = world.formar as FormarState;
  for (const encounter of formar.encounters) {
    if (encounter.closedAtMs !== null) {
      continue;
    }
    for (const side of encounter.sides) {
      const boneco = find(world, side.id);
      if (boneco?.pending?.requestId === side.requestId) {
        put(world, { ...boneco, pending: null });
      }
      side.done = true;
    }
    encounter.closedAtMs = world.timeMs;
  }
}

// --- Invitations ------------------------------------------------------------

function invite(world: World) {
  const formar = world.formar as FormarState;
  for (const boneco of world.bonecos) {
    if (!isFree(world, boneco)) {
      continue;
    }
    const candidates = (formar.affinity[boneco.id] ?? []).flatMap((id) => {
      const other = find(world, id);
      return other && isFree(world, other) ? [other] : [];
    });
    const pair = firstPair(boneco, candidates, formar.refused);
    if (pair) {
      propose(world, boneco, pair);
    }
  }
}

function firstPair(
  boneco: Boneco,
  candidates: Boneco[],
  refused: string[]
): [Boneco, Boneco] | undefined {
  for (const [index, first] of candidates.entries()) {
    for (const second of candidates.slice(index + 1)) {
      if (!refused.includes(trioKey([boneco.id, first.id, second.id]))) {
        return [first, second];
      }
    }
  }
}

function propose(world: World, by: Boneco, [first, second]: [Boneco, Boneco]) {
  const formar = world.formar as FormarState;
  formar.proposalsMade += 1;
  const proposal: Proposal = {
    id: `convite-${formar.proposalsMade}`,
    by: by.id,
    members: [by.id, first.id, second.id],
    askIds: {},
    votes: {},
  };
  for (const member of [by, first, second]) {
    const others = [by, first, second].filter((other) => other !== member);
    let next: Boneco = { ...member, target: null };
    if (member.sessionId === null) {
      proposal.votes[member.id] = true;
    } else {
      const question =
        member === by
          ? `Achei ${names(others.map((other) => other.name))} a nossa cara. Formo um bloco com eles?`
          : `${by.name} chamou a gente e ${others.find((other) => other !== by)?.name} para um bloco. Topa?`;
      next = askHuman(next, world, {
        purpose: "bloco",
        question,
        options: [YES, NO],
        defaultChoice: 0,
      });
      proposal.askIds[member.id] = next.ask?.id ?? "";
    }
    put(world, next);
  }
  formar.proposals.push(proposal);
  note(
    world,
    `${by.name} chamou ${names([first.name, second.name])} para um bloco.`
  );
}

/** Reads the answers the members' bonecos kept. */
function collectVotes(world: World, proposal: Proposal) {
  for (const id of proposal.members) {
    const boneco = find(world, id);
    if (
      boneco?.vote &&
      proposal.votes[id] === undefined &&
      boneco.vote.askId === proposal.askIds[id]
    ) {
      proposal.votes[id] = boneco.vote.yes;
      put(world, { ...boneco, vote: null });
    }
  }
}

function settleProposals(world: World) {
  const formar = world.formar as FormarState;
  formar.proposals = formar.proposals.filter((proposal) => {
    if (proposal.members.some((id) => !find(world, id))) {
      closeAsks(world, proposal);
      return false;
    }
    collectVotes(world, proposal);
    return !decide(world, proposal, false);
  });
  // An answer to an invitation that no longer exists is dropped.
  for (const boneco of world.bonecos) {
    if (boneco.vote && !inProposal(world, boneco.id)) {
      put(world, { ...boneco, vote: null });
    }
  }
}

/** Forms or drops the bloco once the majority is known; true when decided. */
function decide(world: World, proposal: Proposal, final: boolean): boolean {
  const votes = Object.values(proposal.votes);
  const yes = votes.filter(Boolean).length;
  const no = votes.length - yes;
  if (yes >= 2) {
    closeAsks(world, proposal);
    formBloco(world, proposal.members, "convite");
    return true;
  }
  if (no >= 2 || final) {
    closeAsks(world, proposal);
    refuse(world, proposal);
    return true;
  }
  return false;
}

function closeAsks(world: World, proposal: Proposal) {
  for (const id of proposal.members) {
    const boneco = find(world, id);
    if (boneco?.ask && boneco.ask.id === proposal.askIds[id]) {
      put(world, { ...boneco, ask: null });
    }
  }
}

function refuse(world: World, proposal: Proposal) {
  const formar = world.formar as FormarState;
  formar.refused.push(trioKey(proposal.members));
  const by = find(world, proposal.by);
  for (const id of proposal.members) {
    const boneco = find(world, id);
    if (boneco) {
      put(
        world,
        think(
          boneco,
          world,
          "O bloco não saiu: a maioria disse agora não. Sigo procurando.",
          null,
          "aviso"
        )
      );
    }
  }
  if (by) {
    note(world, `O convite de ${by.name} não vingou.`);
  }
}

// --- Blocos -----------------------------------------------------------------

function blocoLabel(bloco: Bloco): string {
  return `Bloco ${bloco.mark + 1}`;
}

function gatherAt(world: World, bloco: Bloco, boneco: Boneco, index: number) {
  const offset = (index - (bloco.members.length - 1) / 2) * BLOCO_SPACING;
  const target: Place = {
    id: `${bloco.id}-ponto`,
    name: blocoLabel(bloco),
    x: Math.min(world.map.width, Math.max(0, bloco.spot.x + offset)),
    y: bloco.spot.y,
  };
  const pending = boneco.pending?.kind === "walk" ? null : boneco.pending;
  return { ...boneco, blocoId: bloco.id, target, pending };
}

function formBloco(world: World, ids: string[], formedBy: Bloco["formedBy"]) {
  if (ids.length === 0) {
    return;
  }
  // Marks are never reused, even after an emptied bloco went away.
  const formar = world.formar as FormarState;
  const mark = formar.blocosMade;
  formar.blocosMade += 1;
  const bloco: Bloco = {
    id: `bloco-${mark + 1}`,
    mark,
    members: [...ids],
    spot: blocoSpot(world, mark),
    formedBy,
  };
  world.blocos.push(bloco);
  const members = ids.map((id) => get(world, id));
  for (const [index, member] of members.entries()) {
    const mates = members
      .filter((other) => other !== member)
      .map((other) => other.name);
    const text =
      mates.length > 0
        ? `Fechamos o ${blocoLabel(bloco)}: eu, ${names(mates)}!`
        : `Sou o ${blocoLabel(bloco)} por enquanto. Já chega mais gente.`;
    put(
      world,
      think(gatherAt(world, bloco, member, index), world, text, null, "aviso")
    );
  }
  note(
    world,
    `${blocoLabel(bloco)} formado: ${names(members.map((member) => member.name))}.`
  );
}

/** Whoever has no bloco after the phase goes to the smallest one. */
function placeLate(world: World) {
  for (const boneco of world.bonecos) {
    if (boneco.blocoId !== null) {
      continue;
    }
    const [smallest] = [...world.blocos].sort(
      (a, b) => a.members.length - b.members.length || a.mark - b.mark
    );
    if (!smallest) {
      formBloco(world, [boneco.id], "atraso");
      continue;
    }
    const mates = smallest.members.map((id) => get(world, id).name);
    smallest.members.push(boneco.id);
    put(
      world,
      think(
        gatherAt(world, smallest, boneco, smallest.members.length - 1),
        world,
        `Cheguei depois, então entrei no ${blocoLabel(smallest)} com ${names(mates)}.`,
        null,
        "aviso"
      )
    );
    note(world, `${boneco.name} chegou e entrou no ${blocoLabel(smallest)}.`);
  }
}

// --- The maestro ------------------------------------------------------------

function runMaestro(
  world: World,
  results: Map<string, BrainResult>
): MaestroRequest | undefined {
  const formar = world.formar as FormarState;
  const { maestro } = formar;
  if (!maestro || maestro.state === "done") {
    return;
  }
  if (maestro.state === "wanted") {
    if (world.models.length === 0) {
      groupByDistance(world, maestro);
      return;
    }
    const people = maestro.leftovers.flatMap((id) => {
      const boneco = find(world, id);
      return boneco ? [acquaintance(boneco)] : [];
    });
    const request: MaestroRequest = {
      kind: "maestro",
      id: `maestro#${world.timeMs}`,
      boneco: { id: "maestro", name: "Maestro" },
      deadlineMs: world.timeMs + world.rules.maestroMs,
      model: null,
      people,
      sizes: maestro.sizes,
    };
    formar.maestro = {
      ...maestro,
      state: "pending",
      requestId: request.id,
      deadlineMs: request.deadlineMs,
    };
    return request;
  }
  const result = results.get(maestro.requestId ?? "");
  const groups =
    result?.ok && result.action.type === "maestro"
      ? validGroups(world, maestro, result.action.groups)
      : undefined;
  if (groups && result?.ok && result.action.type === "maestro") {
    for (const group of groups) {
      formBloco(world, group, "maestro");
    }
    const line = filterModelText(
      result.action.speech,
      world.rules.speechMaxLength
    );
    note(
      world,
      line
        ? `Maestro (${result.model ?? "modelo"}): ${line}`
        : `O maestro juntou quem sobrou em ${groups.length} blocos.`
    );
    formar.maestro = done();
    return;
  }
  if (result || world.timeMs >= maestro.deadlineMs) {
    groupByDistance(world, maestro);
  }
}

/** The maestro's groups as boneco ids, when they split the leftovers exactly. */
function validGroups(
  world: World,
  maestro: Maestro,
  groups: string[][]
): string[][] | undefined {
  const byName = new Map(
    maestro.leftovers.flatMap((id) => {
      const boneco = find(world, id);
      return boneco ? [[boneco.name, id] as const] : [];
    })
  );
  if (byName.size !== maestro.leftovers.length) {
    return;
  }
  const seen = new Set<string>();
  const ids: string[][] = [];
  for (const group of groups) {
    const members: string[] = [];
    for (const name of group) {
      const id = byName.get(name);
      if (!id || seen.has(id)) {
        return;
      }
      seen.add(id);
      members.push(id);
    }
    ids.push(members);
  }
  const sizes = ids.map((group) => group.length).sort();
  const wanted = [...maestro.sizes].sort();
  if (
    seen.size !== maestro.leftovers.length ||
    sizes.join() !== wanted.join()
  ) {
    return;
  }
  return ids;
}

/** The fallback: each bloco starts at the leftmost boneco and takes the nearest. */
function groupByDistance(world: World, maestro: Maestro) {
  const formar = world.formar as FormarState;
  let left = maestro.leftovers.flatMap((id) => {
    const boneco = find(world, id);
    return boneco && boneco.blocoId === null ? [boneco] : [];
  });
  for (const size of sizesFor(left.length)) {
    const [seed] = [...left].sort((a, b) => a.x - b.x || a.y - b.y);
    if (!seed) {
      break;
    }
    const nearest = left
      .filter((boneco) => boneco !== seed)
      .sort(
        (a, b) =>
          Math.hypot(a.x - seed.x, a.y - seed.y) -
          Math.hypot(b.x - seed.x, b.y - seed.y)
      )
      .slice(0, size - 1);
    const group = [seed, ...nearest];
    formBloco(
      world,
      group.map((boneco) => boneco.id),
      "proximidade"
    );
    left = left.filter((boneco) => !group.includes(boneco));
  }
  note(
    world,
    "O maestro não respondeu a tempo: juntei quem estava mais perto."
  );
  formar.maestro = done();
}
