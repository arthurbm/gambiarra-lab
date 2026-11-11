// The compor phase: each bloco gathers at its meeting spot and composes. First
// the name: every boneco proposes one (a model decision) and the bloco's
// humans vote on their phones. Then the refrain: every boneco proposes two to
// four verses about what the humans share, and they vote again. When there is
// time left, one more round lets the bonecos rework the chosen refrain, with
// keeping it as the first option.
//
// Votes: the most voted option wins, a tie is drawn by the world's generator,
// and with no vote the first proposal wins. A boneco whose model does not
// propose is left out of the round; with no proposal at all the bloco gets a
// reserve name or refrain. Blocos the maestro delivers after the phase begins
// and late arrivals take part in whatever is still open. When the phase ends,
// every bloco has a name and a refrain.
//
// The world calls `stepCompor` on every step; `enterCompor` and `closeCompor`
// are the phase's hooks (wired in `phases.ts`).
import { BONECO_REMOVED_HOOKS } from "./admin";
import type { Ask, AskOutcome } from "./ask";
import { filterModelText, isBlocked } from "./blocklist";
import { logEvent } from "./events";
import type { Bloco } from "./formar";
import {
  type Acquaintance,
  askHuman,
  type Boneco,
  type BrainResult,
  type DecisionKind,
  type DecisionRequest,
  type NameRequest,
  type RefrainRequest,
  roll,
  say,
  think,
  type World,
} from "./world";

/** The ask purpose of a vote; the world hands its outcome to `votoAnswered`. */
export const VOTE_PURPOSE = "voto";
/** Longest name a model may propose; a longer one is refused, not cut. */
export const NAME_MAX_LENGTH = 40;
/** Longest verse; a refrain with a longer one is refused, not cut. */
export const VERSE_MAX_LENGTH = 60;
export const REFRAIN_MIN_LINES = 2;
export const REFRAIN_MAX_LINES = 4;
const COMMON_MAX_LENGTH = 100;
/** Map units between bonecos standing at their bloco's spot. */
const SPACING = 5;
/** Slack on top of one proposal and one vote before a rework round starts. */
const REWORK_SLACK_MS = 6000;

export type ComporRound = "ajuste" | "nome" | "refrao";

interface Offer {
  /** Boneco id; null for keeping the current refrain. */
  by: string | null;
  lines: string[];
  model: string | null;
}

interface Proposing {
  deadlineMs: number;
  done: boolean;
  requestId: string;
}

interface Track {
  /** The vote ask each human got this round, by boneco id. */
  askIds: Record<string, string>;
  blocoId: string;
  offers: Offer[];
  /** Proposal requests of this round, by boneco id. */
  proposing: Record<string, Proposing>;
  round: ComporRound | "pronto";
  stage: "propondo" | "votando";
  /** Each human's vote this round, by boneco id; null when they let it pass. */
  votes: Record<string, number | null>;
}

export interface ComporState {
  /** Rounds run only while the phase is open. */
  open: boolean;
  tracks: Track[];
}

/** The bloco's rounds as every phone of the bloco shows them. */
export interface ComposeView {
  name: string | null;
  /** What is on the vote, in the same order on every phone; empty while proposing. */
  options: { by: string | null; lines: string[] }[];
  /** Proposals that arrived so far in this round. */
  proposals: number;
  refrain: string[] | null;
  round: ComporRound | "pronto";
  /** How many humans the bloco has. */
  voters: number;
  /** How many of the bloco's humans voted in this round. */
  votes: number;
  voting: boolean;
  /** This phone's vote in this round, as an option index. */
  yourVote: number | null;
}

const RESERVE_NAMES = [
  "Bloco do Passo Ligeiro",
  "Bloco da Sombrinha Furada",
  "Bloco dos Metais Acesos",
  "Bloco Maré de Março",
  "Bloco do Frevo Sem Freio",
  "Bloco da Ladeira Acima",
  "Bloco do Sol de Olinda",
  "Bloco Tapioca Elétrica",
  "Bloco dos Foliões da Praça",
  "Bloco do Último Compasso",
];

const QUESTIONS: Record<ComporRound, string> = {
  nome: "Qual nome fica para o nosso bloco?",
  refrao: "Qual refrão o bloco canta?",
  ajuste: "Fica o refrão de agora ou entra o ajuste?",
};

// --- Hooks the world and the phase clock call -------------------------------

/** The compor phase begins: blocos start composing on the next step. */
export function enterCompor(world: World): World {
  if (world.compor?.open) {
    return world;
  }
  return logEvent(
    { ...world, compor: { open: true, tracks: world.compor?.tracks ?? [] } },
    "Hora de compor! Cada bloco escolhe um nome e um refrão."
  );
}

/**
 * The compor phase ends. The round each bloco is in is decided with the votes
 * given so far, open votes and proposals are called off, and every bloco
 * without a name or a refrain gets a reserve one.
 */
export function closeCompor(world: World): World {
  if (!world.compor?.open) {
    return world;
  }
  const draft = edit(world);
  const compor = draft.compor as ComporState;
  compor.open = false;
  for (const track of compor.tracks) {
    const bloco = blocoOf(draft, track);
    if (!bloco || track.round === "pronto") {
      continue;
    }
    collectBallots(draft, track, bloco);
    if (track.stage === "votando") {
      conclude(draft, track, bloco);
    } else if (track.offers.length > 0) {
      settle(draft, track, bloco, 0);
    }
    stopRound(draft, track, bloco);
    track.round = "pronto";
  }
  fillReserve(draft);
  return draft;
}

/** A boneco left the world: it no longer proposes or votes. */
export function leaveCompor(world: World, bonecoId: string): World {
  if (!world.compor) {
    return world;
  }
  const draft = edit(world);
  for (const track of (draft.compor as ComporState).tracks) {
    delete track.proposing[bonecoId];
    delete track.askIds[bonecoId];
    delete track.votes[bonecoId];
  }
  return draft;
}

BONECO_REMOVED_HOOKS.push(leaveCompor);

/** Decisions this module settles instead of the boneco's own step. */
export function holdsComposeDecision(kind: DecisionKind): boolean {
  return kind === "nome" || kind === "refrao";
}

/** The ask handler for a vote: the boneco keeps the vote for the round. */
export function votoAnswered(
  boneco: Boneco,
  world: World,
  ask: Ask,
  outcome: AskOutcome
): Boneco {
  if (outcome.by === "boneco") {
    return {
      ...think(
        boneco,
        world,
        "O tempo acabou e você não votou. Vale o voto de quem votou.",
        null,
        "aviso"
      ),
      ballot: { askId: ask.id, choice: null },
    };
  }
  return { ...boneco, ballot: { askId: ask.id, choice: outcome.choice } };
}

/** The compor panel of one boneco's phone; null outside a bloco or before the phase. */
export function composeView(world: World, boneco: Boneco): ComposeView | null {
  const bloco = world.blocos.find((other) => other.id === boneco.blocoId);
  if (!(bloco && world.compor)) {
    return null;
  }
  const track = world.compor.tracks.find((one) => one.blocoId === bloco.id);
  const voters = bloco.members.filter(
    (id) => (find(world, id)?.sessionId ?? null) !== null
  ).length;
  const voting = track?.stage === "votando" && track.round !== "pronto";
  const votes = track
    ? bloco.members.filter(
        (id) => typeof votedIn(world, track, id) === "number"
      ).length
    : 0;
  return {
    name: bloco.name,
    refrain: bloco.refrain,
    round: track?.round ?? "nome",
    voting,
    options: voting && track ? track.offers.map(optionView(world)) : [],
    proposals: track?.offers.filter((offer) => offer.by !== null).length ?? 0,
    votes: voting ? votes : 0,
    voters,
    yourVote:
      voting && track ? (votedIn(world, track, boneco.id) ?? null) : null,
  };
}

// --- The step ---------------------------------------------------------------

/** One step of the compor phase, after the bonecos moved. */
export function stepCompor(
  world: World,
  results: Map<string, BrainResult>
): { requests: DecisionRequest[]; world: World } {
  if (!world.compor) {
    return { world, requests: [] };
  }
  const draft = edit(world);
  const compor = draft.compor as ComporState;
  const requests: DecisionRequest[] = [];
  if (!compor.open) {
    if (draft.blocos.some((bloco) => !(bloco.name && bloco.refrain))) {
      fillReserve(draft);
      return { world: draft, requests };
    }
    return { world, requests };
  }
  for (const bloco of draft.blocos) {
    if (!compor.tracks.some((track) => track.blocoId === bloco.id)) {
      compor.tracks.push(startTrack(draft, bloco));
    }
  }
  for (const track of compor.tracks) {
    const bloco = blocoOf(draft, track);
    if (bloco && track.round !== "pronto") {
      requests.push(...advance(draft, track, bloco, results));
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
    blocos: world.blocos.map((bloco) => ({ ...bloco })),
    compor: world.compor ? structuredClone(world.compor) : null,
  };
}

function find(world: World, id: string): Boneco | undefined {
  return world.bonecos.find((boneco) => boneco.id === id);
}

function put(world: World, boneco: Boneco) {
  const index = world.bonecos.findIndex((other) => other.id === boneco.id);
  if (index >= 0) {
    world.bonecos[index] = boneco;
  }
}

function blocoOf(world: World, track: Track): Bloco | undefined {
  return world.blocos.find((bloco) => bloco.id === track.blocoId);
}

function note(world: World, text: string) {
  world.events = logEvent(world, text).events;
}

function label(bloco: Bloco): string {
  return bloco.name ? `«${bloco.name}»` : `Bloco ${bloco.mark + 1}`;
}

function acquaintance(boneco: Boneco): Acquaintance {
  return {
    name: boneco.name,
    personality: boneco.personality,
    instrument: boneco.instrument,
  };
}

function optionView(world: World) {
  return (offer: Offer) => ({
    by: offer.by ? (find(world, offer.by)?.name ?? null) : null,
    lines: offer.lines,
  });
}

/** Done with the interview and not waiting for anything. */
function isFree(boneco: Boneco): boolean {
  return (
    boneco.pending === null &&
    (boneco.interview === null || boneco.interview.stage === "done")
  );
}

/** The vote of a member in this round: an index, null when it passed, undefined when still open. */
function votedIn(
  world: World,
  track: Track,
  id: string
): number | null | undefined {
  if (id in track.votes) {
    return track.votes[id];
  }
  const ballot = find(world, id)?.ballot;
  if (ballot && ballot.askId === track.askIds[id]) {
    return ballot.choice;
  }
}

// --- Rounds -----------------------------------------------------------------

function startTrack(world: World, bloco: Bloco): Track {
  // Everyone walks to the bloco's meeting spot.
  for (const [index, id] of bloco.members.entries()) {
    const boneco = find(world, id);
    if (!boneco) {
      continue;
    }
    const offset = (index - (bloco.members.length - 1) / 2) * SPACING;
    const x = Math.min(world.map.width, Math.max(0, bloco.spot.x + offset));
    if (boneco.x !== x || boneco.y !== bloco.spot.y) {
      put(world, {
        ...boneco,
        target: {
          id: `${bloco.id}-ponto`,
          name: `Bloco ${bloco.mark + 1}`,
          x,
          y: bloco.spot.y,
        },
      });
    }
  }
  return newRound(bloco.id, "nome", []);
}

function newRound(
  blocoId: string,
  round: ComporRound | "pronto",
  offers: Offer[]
): Track {
  return {
    blocoId,
    round,
    stage: "propondo",
    proposing: {},
    offers,
    askIds: {},
    votes: {},
  };
}

function advance(
  world: World,
  track: Track,
  bloco: Bloco,
  results: Map<string, BrainResult>
): DecisionRequest[] {
  const requests: DecisionRequest[] = [];
  if (track.stage === "propondo") {
    settleProposals(world, track, results);
    requests.push(...askProposals(world, track, bloco));
    const asked = Object.values(track.proposing);
    if (asked.length > 0 && asked.every((one) => one.done)) {
      openVote(world, track, bloco);
    }
  }
  if (track.stage === "votando") {
    collectBallots(world, track, bloco);
    openBallots(world, track, bloco);
    const waiting = Object.keys(track.askIds).some(
      (id) => !(id in track.votes) && find(world, id)
    );
    if (!waiting) {
      conclude(world, track, bloco);
    }
  }
  return requests;
}

function askProposals(
  world: World,
  track: Track,
  bloco: Bloco
): DecisionRequest[] {
  const requests: DecisionRequest[] = [];
  const people = bloco.members.flatMap((id) => {
    const boneco = find(world, id);
    return boneco ? [acquaintance(boneco)] : [];
  });
  for (const id of bloco.members) {
    const boneco = find(world, id);
    if (!boneco || id in track.proposing || !isFree(boneco)) {
      continue;
    }
    const base = {
      id: `${boneco.id}#${boneco.decisions + 1}`,
      boneco: { id: boneco.id, name: boneco.name },
      deadlineMs: world.timeMs + world.rules.decisionTimeoutMs,
      model: boneco.assignedModel,
      people,
    };
    const request: NameRequest | RefrainRequest =
      track.round === "nome"
        ? {
            ...base,
            kind: "nome",
            taken: world.blocos.flatMap((other) =>
              other.name && other.id !== bloco.id ? [other.name] : []
            ),
          }
        : {
            ...base,
            kind: "refrao",
            blocoName: bloco.name ?? `Bloco ${bloco.mark + 1}`,
            current: track.round === "ajuste" ? bloco.refrain : null,
          };
    track.proposing[id] = {
      requestId: request.id,
      deadlineMs: request.deadlineMs,
      done: false,
    };
    put(world, {
      ...boneco,
      decisions: boneco.decisions + 1,
      pending: {
        requestId: request.id,
        deadlineMs: request.deadlineMs,
        kind: request.kind,
        sinceMs: world.timeMs,
      },
    });
    requests.push(request);
  }
  return requests;
}

function settleProposals(
  world: World,
  track: Track,
  results: Map<string, BrainResult>
) {
  for (const [id, proposing] of Object.entries(track.proposing)) {
    if (proposing.done) {
      continue;
    }
    const boneco = find(world, id);
    if (boneco?.pending?.requestId !== proposing.requestId) {
      proposing.done = true;
      continue;
    }
    const result = results.get(proposing.requestId);
    const lines = result?.ok ? accepted(track.round, result.action) : null;
    if (result?.ok && lines) {
      const model = result.model ?? null;
      const common =
        result.action.type === "refrao"
          ? filterModelText(result.action.common, COMMON_MAX_LENGTH)
          : null;
      propose(world, track, { ...boneco, brain: "model", model }, lines, model);
      if (common) {
        const proposer = find(world, id) as Boneco;
        put(
          world,
          think(proposer, world, `Em comum: ${common}`, model, "fala")
        );
      }
      proposing.done = true;
    } else if (result || world.timeMs >= proposing.deadlineMs) {
      put(
        world,
        think(
          { ...boneco, pending: null, brain: "autopilot", model: null },
          world,
          "Meu modelo não trouxe ideia desta vez. Fico com as do bloco.",
          null,
          "aviso"
        )
      );
      proposing.done = true;
    }
  }
}

/** The proposal as verses, or null when it does not fit the round. */
function accepted(
  round: Track["round"],
  action: Extract<BrainResult, { ok: true }>["action"]
): string[] | null {
  if (round === "nome") {
    if (action.type !== "nome") {
      return null;
    }
    const name = verse(action.name.replace(/["«»“”]/g, ""), NAME_MAX_LENGTH);
    return name ? [name] : null;
  }
  if (action.type !== "refrao") {
    return null;
  }
  if (
    action.lines.length < REFRAIN_MIN_LINES ||
    action.lines.length > REFRAIN_MAX_LINES
  ) {
    return null;
  }
  const lines = action.lines.map((line) => verse(line, VERSE_MAX_LENGTH));
  return lines.every((line) => line !== null) ? (lines as string[]) : null;
}

/** One line of model text, refused (not cut) when longer than `max`. */
function verse(text: unknown, max: number): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length > max) {
    return null;
  }
  return filterModelText(clean, max);
}

function propose(
  world: World,
  track: Track,
  boneco: Boneco,
  lines: string[],
  model: string | null
) {
  const same = track.offers.some(
    (offer) =>
      offer.lines.join("\n").toLowerCase() === lines.join("\n").toLowerCase()
  );
  if (!same) {
    track.offers.push({ by: boneco.id, lines, model });
  }
  const balloon =
    track.round === "nome" ? `Que tal «${lines[0]}»?` : lines.join(" / ");
  const thought =
    track.round === "nome"
      ? `Proponho o nome «${lines[0]}».`
      : `Proponho o refrão: ${lines.join(" / ")}`;
  let next = say({ ...boneco, pending: null }, world, balloon);
  next = think(next, world, thought, model, "fala");
  put(world, next);
}

function openVote(world: World, track: Track, bloco: Bloco) {
  const proposals = track.offers.filter((offer) => offer.by !== null);
  if (proposals.length === 0) {
    // Nobody proposed: a reserve, or the refrain stays as it is.
    if (track.round === "nome" || track.round === "refrao") {
      track.offers = [
        { by: null, lines: reserveFor(world, bloco, track.round), model: null },
      ];
      note(
        world,
        `Os modelos do ${label(bloco)} ficaram calados: entrou ${track.round === "nome" ? "um nome" : "um refrão"} de reserva.`
      );
    }
    settle(world, track, bloco, 0);
    return;
  }
  if (track.offers.length === 1) {
    settle(world, track, bloco, 0);
    return;
  }
  track.stage = "votando";
}

function openBallots(world: World, track: Track, bloco: Bloco) {
  const options = track.offers.map((offer) =>
    offer.by === null && track.round === "ajuste"
      ? `Manter: ${offer.lines.join("\n")}`
      : offer.lines.join("\n")
  );
  for (const id of bloco.members) {
    const boneco = find(world, id);
    if (
      !boneco ||
      boneco.sessionId === null ||
      id in track.askIds ||
      boneco.ask !== null ||
      !(boneco.interview === null || boneco.interview.stage === "done")
    ) {
      continue;
    }
    const asked = askHuman({ ...boneco, ballot: null }, world, {
      purpose: VOTE_PURPOSE,
      question: QUESTIONS[track.round as ComporRound],
      options,
      defaultChoice: null,
    });
    put(world, asked);
    const askId = asked.ask?.id ?? "";
    track.askIds[id] = askId;
  }
}

/** Reads the votes the members' bonecos kept. */
function collectBallots(world: World, track: Track, bloco: Bloco) {
  for (const id of bloco.members) {
    const boneco = find(world, id);
    if (boneco?.ballot && boneco.ballot.askId === track.askIds[id]) {
      track.votes[id] = boneco.ballot.choice;
      put(world, { ...boneco, ballot: null });
    }
  }
}

/** Counts the votes: most votes wins, a tie is drawn, no vote is the first. */
function conclude(world: World, track: Track, bloco: Bloco) {
  const counts = track.offers.map(() => 0);
  for (const choice of Object.values(track.votes)) {
    if (choice !== null && choice >= 0 && choice < counts.length) {
      counts[choice] = (counts[choice] ?? 0) + 1;
    }
  }
  const most = Math.max(0, ...counts);
  let winner = 0;
  if (most > 0) {
    const tied = counts.flatMap((count, index) =>
      count === most ? [index] : []
    );
    winner = tied[Math.floor(roll(world) * tied.length)] ?? 0;
  }
  settle(world, track, bloco, winner);
}

/** The round's outcome goes into the bloco, and the next round begins. */
function settle(world: World, track: Track, bloco: Bloco, winner: number) {
  const offer = track.offers[winner] ?? track.offers[0];
  const { round } = track;
  stopRound(world, track, bloco);
  if (offer && round === "nome") {
    const before = label(bloco);
    bloco.name = offer.lines[0] ?? null;
    note(world, `${before} agora se chama ${label(bloco)}.`);
    tell(world, bloco, `Nosso bloco agora é ${label(bloco)}!`);
  } else if (offer && round === "refrao") {
    bloco.refrain = offer.lines;
    note(world, `Refrão do ${label(bloco)}: ${offer.lines.join(" / ")}`);
    tell(world, bloco, `Nosso refrão: ${offer.lines.join(" / ")}`);
  } else if (offer && round === "ajuste") {
    if (offer.by === null) {
      note(world, `O ${label(bloco)} manteve o refrão.`);
    } else {
      bloco.refrain = offer.lines;
      note(
        world,
        `O ${label(bloco)} ajustou o refrão: ${offer.lines.join(" / ")}`
      );
      tell(world, bloco, `Refrão ajustado: ${offer.lines.join(" / ")}`);
    }
  }
  let nextRound: Track["round"] = "pronto";
  if (round === "nome") {
    nextRound = "refrao";
  } else if (round === "refrao" && timeForRework(world)) {
    nextRound = "ajuste";
  }
  const offers: Offer[] =
    nextRound === "ajuste" && bloco.refrain
      ? [{ by: null, lines: bloco.refrain, model: null }]
      : [];
  Object.assign(track, newRound(bloco.id, nextRound, offers));
}

/** Calls off what the round still waits for: proposals and open votes. */
function stopRound(world: World, track: Track, bloco: Bloco) {
  for (const id of bloco.members) {
    const boneco = find(world, id);
    if (!boneco) {
      continue;
    }
    const proposing = track.proposing[id];
    let next = boneco;
    if (proposing && boneco.pending?.requestId === proposing.requestId) {
      next = { ...next, pending: null };
    }
    if (boneco.ask && boneco.ask.id === track.askIds[id]) {
      next = { ...next, ask: null };
    }
    if (boneco.ballot) {
      next = { ...next, ballot: null };
    }
    if (next !== boneco) {
      put(world, next);
    }
  }
}

function tell(world: World, bloco: Bloco, text: string) {
  for (const id of bloco.members) {
    const boneco = find(world, id);
    if (boneco) {
      put(world, think(boneco, world, text, null, "aviso"));
    }
  }
}

/** Whether the phase has time for one more proposal and one more vote. */
function timeForRework(world: World): boolean {
  const left = world.phaseClock.durations.compor - world.phaseClock.elapsedMs;
  return (
    left >= world.rules.decisionTimeoutMs + world.rules.askMs + REWORK_SLACK_MS
  );
}

// --- Reserve ----------------------------------------------------------------

function fillReserve(world: World) {
  for (const bloco of world.blocos) {
    if (!bloco.name) {
      bloco.name = reserveFor(world, bloco, "nome")[0] ?? null;
      note(world, `O Bloco ${bloco.mark + 1} saiu como ${label(bloco)}.`);
    }
    if (!bloco.refrain) {
      bloco.refrain = reserveFor(world, bloco, "refrao");
    }
  }
}

function reserveFor(
  world: World,
  bloco: Bloco,
  round: "nome" | "refrao"
): string[] {
  if (round === "nome") {
    const taken = world.blocos.flatMap((other) =>
      other.name ? [other.name] : []
    );
    const free = RESERVE_NAMES.filter((each) => !taken.includes(each));
    const pool = free.length > 0 ? free : RESERVE_NAMES;
    const name = pool[bloco.mark % pool.length] as string;
    return [free.length > 0 ? name : `${name} ${bloco.mark + 1}`];
  }
  const instruments = [
    ...new Set(
      bloco.members.flatMap((id) => {
        const instrument = find(world, id)?.instrument;
        return instrument ? [instrument] : [];
      })
    ),
  ];
  const joined =
    instruments.length > 1
      ? `${instruments.slice(0, -1).join(", ")} e ${instruments.at(-1)}`
      : (instruments[0] ?? "");
  const together =
    instruments.length > 0 && joined.length <= 40 && !isBlocked(joined)
      ? `De ${joined} no mesmo passo`
      : "Cada um com seu passo";
  return [
    `Chegou a vez do ${bloco.name ?? `Bloco ${bloco.mark + 1}`}`,
    together,
    "A gente se achou na praça",
    "E o frevo fez o resto",
  ];
}
