// The desfile and the final. The blocos parade one at a time, in the order
// they formed, each for an equal share of the phase; the host may move to the
// next or back to the previous one, and marks up to three blocos as chosen.
// The final shows every bloco and which ones the host chose.
//
// The bloco on stage is derived from the phase clock, so pausing holds it and
// nothing needs to step here. A bloco's name and refrain come from the compor
// phase; a bloco without them parades as "Bloco N" with a default refrain.
import { logEvent } from "./events";
import type { Bloco, Boneco, Instrument, World } from "./world";

export interface DesfileState {
  /** Ids of the blocos the host chose, in the order they were marked. */
  chosen: string[];
  /** The bloco the host last put on stage, by its place in the parade. */
  index: number;
  /** Phase time when that bloco went on stage. */
  sinceMs: number;
}

/** A member of a bloco, as the desfile shows it. */
export interface DesfileMember {
  id: string;
  instrument: Instrument | null;
  look: number;
  /** The models that thought for this boneco, the one that answered last first. */
  models: string[];
  name: string;
}

export interface DesfileBloco {
  chosen: boolean;
  id: string;
  mark: number;
  members: DesfileMember[];
  /** Every model that thought for a member, without repeats. */
  models: string[];
  name: string;
  /** 1 to 3, in the order the host marked it; null when not chosen. */
  placement: number | null;
  refrain: string[];
}

/** What the telão and the admin show of the desfile and the final. */
export interface DesfileView {
  /** In parade order. */
  blocos: DesfileBloco[];
  /** Ids of the chosen blocos, in the order the host marked them. */
  chosen: string[];
  /** Index in `blocos` of the bloco on stage; null in the final or with none. */
  current: number | null;
  /** Time left for the bloco on stage; null when none is. */
  currentRemainingMs: number | null;
  maxChosen: number;
  phase: "desfile" | "final";
  /** Each bloco's share of the phase. */
  slotMs: number;
}

/** What one person's phone shows of the desfile and the final. */
export interface PhoneDesfile {
  chosen: boolean;
  name: string;
  /** The person's bloco is on stage now. */
  onStage: boolean;
  phase: "desfile" | "final";
  placement: number | null;
  refrain: string[];
}

export const MAX_CHOSEN = 3;

/** The refrain of a bloco that reached the desfile without one. */
export const DEFAULT_REFRAIN = [
  "Lá vem o bloco na praça",
  "Sombrinha girando no ar",
  "Quem chega junto não passa",
  "Sem o frevo pra dançar",
];

/** The compor phase adds these to the bloco; read them only through here. */
type Composed = Bloco & { name?: string | null; refrain?: string[] | null };

export function blocoName(bloco: Bloco): string {
  return (bloco as Composed).name || `Bloco ${bloco.mark + 1}`;
}

export function blocoRefrain(bloco: Bloco): string[] {
  const { refrain } = bloco as Composed;
  return refrain && refrain.length > 0 ? refrain : DEFAULT_REFRAIN;
}

function unique(items: (string | null)[]): string[] {
  return [...new Set(items.filter((item): item is string => !!item))];
}

function modelsOf(boneco: Boneco): string[] {
  return unique([
    boneco.model,
    boneco.assignedModel,
    ...boneco.thoughts.map((thought) => thought.model),
  ]);
}

/** The blocos that parade, in the order they formed. */
function parade(world: World): Bloco[] {
  return world.blocos
    .filter((bloco) => bloco.members.length > 0)
    .sort((a, b) => a.mark - b.mark);
}

function slotOf(world: World, count: number): number {
  return Math.floor(world.phaseClock.durations.desfile / Math.max(1, count));
}

/** The place in the parade of the bloco on stage, or null with none. */
function currentIndex(world: World): number | null {
  const state = world.desfile;
  const count = parade(world).length;
  if (!state || world.phase !== "desfile" || count === 0) {
    return null;
  }
  const slot = slotOf(world, count);
  const passed = Math.floor(
    Math.max(0, world.phaseClock.elapsedMs - state.sinceMs) / Math.max(1, slot)
  );
  return Math.min(count - 1, Math.max(0, state.index + passed));
}

function chosenOf(world: World): string[] {
  const ids = new Set(parade(world).map((bloco) => bloco.id));
  return (world.desfile?.chosen ?? []).filter((id) => ids.has(id));
}

function describeBloco(world: World, bloco: Bloco): DesfileBloco {
  const chosen = chosenOf(world);
  const members = bloco.members.flatMap((id): DesfileMember[] => {
    const boneco = world.bonecos.find((other) => other.id === id);
    return boneco
      ? [
          {
            id: boneco.id,
            name: boneco.name,
            look: boneco.look,
            instrument: boneco.instrument,
            models: modelsOf(boneco),
          },
        ]
      : [];
  });
  const placement = chosen.indexOf(bloco.id);
  return {
    id: bloco.id,
    mark: bloco.mark,
    name: blocoName(bloco),
    refrain: blocoRefrain(bloco),
    members,
    models: unique(members.flatMap((member) => member.models)),
    chosen: placement >= 0,
    placement: placement >= 0 ? placement + 1 : null,
  };
}

export function desfileView(world: World): DesfileView | null {
  if (
    !(world.desfile && (world.phase === "desfile" || world.phase === "final"))
  ) {
    return null;
  }
  const blocos = parade(world);
  const slotMs = slotOf(world, blocos.length);
  const current = currentIndex(world);
  let currentRemainingMs: number | null = null;
  if (current !== null) {
    const startedMs =
      world.desfile.sinceMs + (current - world.desfile.index) * slotMs;
    currentRemainingMs = Math.max(
      0,
      startedMs + slotMs - world.phaseClock.elapsedMs
    );
  }
  return {
    phase: world.phase,
    blocos: blocos.map((bloco) => describeBloco(world, bloco)),
    chosen: chosenOf(world),
    current,
    currentRemainingMs,
    slotMs,
    maxChosen: MAX_CHOSEN,
  };
}

// --- Hooks the phase clock calls -------------------------------------------

export function enterDesfile(world: World): World {
  const [first] = parade(world);
  const next: World = {
    ...world,
    desfile: { index: 0, sinceMs: 0, chosen: world.desfile?.chosen ?? [] },
  };
  return logEvent(
    next,
    first
      ? `Começou o desfile! Abre a avenida: ${blocoName(first)}.`
      : "Começou o desfile!"
  );
}

export function enterFinal(world: World): World {
  const chosen = chosenOf(world);
  const names = parade(world)
    .filter((bloco) => chosen.includes(bloco.id))
    .map(blocoName);
  return logEvent(
    world,
    names.length > 0
      ? `Fim do desfile! Escolhidos do júri: ${names.join(", ")}.`
      : "Fim do desfile!"
  );
}

// --- What the host does from the admin ---------------------------------------

/** Puts the bloco at `index` of the parade on stage, with a full share. */
function putOnStage(world: World, index: number): World {
  const count = parade(world).length;
  if (!world.desfile || world.phase !== "desfile" || count === 0) {
    return world;
  }
  return {
    ...world,
    desfile: {
      ...world.desfile,
      index: Math.min(count - 1, Math.max(0, index)),
      sinceMs: world.phaseClock.elapsedMs,
    },
  };
}

export function nextBloco(world: World): World {
  const current = currentIndex(world);
  return current === null ? world : putOnStage(world, current + 1);
}

export function previousBloco(world: World): World {
  const current = currentIndex(world);
  return current === null ? world : putOnStage(world, current - 1);
}

/** Marks or unmarks a bloco as chosen; refuses a fourth one. */
export function setChosen(
  world: World,
  blocoId: string,
  chosen: boolean
): { error?: string; world: World } {
  if (
    !(world.desfile && (world.phase === "desfile" || world.phase === "final"))
  ) {
    return { world, error: "O júri só escolhe no desfile e no final." };
  }
  if (!parade(world).some((bloco) => bloco.id === blocoId)) {
    return { world, error: "Bloco não encontrado." };
  }
  const current = chosenOf(world);
  if (chosen === current.includes(blocoId)) {
    return { world };
  }
  if (chosen && current.length >= MAX_CHOSEN) {
    return { world, error: `Já há ${MAX_CHOSEN} blocos escolhidos.` };
  }
  const next = chosen
    ? [...current, blocoId]
    : current.filter((id) => id !== blocoId);
  const target = parade(world).find((other) => other.id === blocoId) as Bloco;
  return {
    world: logEvent(
      { ...world, desfile: { ...world.desfile, chosen: next } },
      chosen
        ? `O júri escolheu ${blocoName(target)}!`
        : `O júri desmarcou ${blocoName(target)}.`
    ),
  };
}

// --- The phone -------------------------------------------------------------

export function phoneDesfile(
  world: World,
  bonecoId: string
): PhoneDesfile | null {
  const view = desfileView(world);
  const index =
    view?.blocos.findIndex((bloco) =>
      bloco.members.some((member) => member.id === bonecoId)
    ) ?? -1;
  const own = view?.blocos[index];
  if (!(view && own)) {
    return null;
  }
  return {
    phase: view.phase,
    name: own.name,
    refrain: own.refrain,
    onStage: view.current === index,
    chosen: own.chosen,
    placement: own.placement,
  };
}
