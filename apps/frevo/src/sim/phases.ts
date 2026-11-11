// The phases of the dynamic and their clock. The entrance waits for the host;
// "formar", "compor" and "desfile" run on a clock and the next one starts when
// the time is up; the final stays. The host may pause (the clock and every
// question's countdown stop, the bonecos keep walking), change durations at
// any time, advance by hand and restart from zero.
//
// What happens inside each phase is not here: a phase plugs its rules into
// PHASE_HOOKS. The world only keeps the clock's data; this module moves it,
// and `tick` is the step the server runs. The hooks are wired here, not in
// each phase's module, so a phase imports the world and never this module.
import { closeCompor, enterCompor } from "./compor";
import { enterDesfile, enterFinal } from "./desfile";
import { closeFormar, enterFormar } from "./formar";
import {
  type BrainResult,
  createWorld,
  DEFAULT_PHASE_DURATIONS,
  type DecisionRequest,
  PHASES,
  type Phase,
  type PhaseDurations,
  step,
  type TimedPhase,
  type World,
} from "./world";

export {
  DEFAULT_PHASE_DURATIONS,
  PHASES,
  type Phase,
  type PhaseDurations,
  type TimedPhase,
} from "./world";

export interface PhaseHooks {
  /** Runs right after the phase starts; `world.phase` is already this one. */
  onEnter?: (world: World) => World;
  /** Runs right before the phase ends; `world.phase` is still this one. */
  onExit?: (world: World) => World;
}

/** What each phase does when it starts and ends. */
export const PHASE_HOOKS: Partial<Record<Phase, PhaseHooks | undefined>> = {
  // The phase clock changes the phase; closing only ends the encounters and
  // hands whoever is left to the maestro.
  formar: { onEnter: enterFormar, onExit: closeFormar },
  // Every bloco leaves the compor phase with a name and a refrain.
  compor: { onEnter: enterCompor, onExit: closeCompor },
  desfile: { onEnter: enterDesfile },
  final: { onEnter: enterFinal },
};

export interface PhaseStatus {
  /** Null for the phases without a clock. */
  durationMs: number | null;
  durations: PhaseDurations;
  paused: boolean;
  phase: Phase;
  remainingMs: number | null;
}

function isTimed(phase: Phase): phase is TimedPhase {
  return phase in DEFAULT_PHASE_DURATIONS;
}

export function phaseStatus(world: World): PhaseStatus {
  const { phase, phaseClock } = world;
  const durationMs = isTimed(phase) ? phaseClock.durations[phase] : null;
  return {
    phase,
    paused: phaseClock.paused,
    durationMs,
    remainingMs:
      durationMs === null
        ? null
        : Math.max(0, durationMs - phaseClock.elapsedMs),
    durations: { ...phaseClock.durations },
  };
}

/** Ends the current phase and starts the next one; the final stays. */
export function advancePhase(world: World): World {
  const index = PHASES.indexOf(world.phase);
  const nextPhase = PHASES[index + 1];
  if (!nextPhase) {
    return world;
  }
  let next = PHASE_HOOKS[world.phase]?.onExit?.(world) ?? world;
  next = {
    ...next,
    phase: nextPhase,
    phaseClock: { ...next.phaseClock, elapsedMs: 0 },
  };
  return PHASE_HOOKS[nextPhase]?.onEnter?.(next) ?? next;
}

export function setPaused(world: World, paused: boolean): World {
  return { ...world, phaseClock: { ...world.phaseClock, paused } };
}

/** Changes durations, before or during the dynamic. Bad values are ignored. */
export function setPhaseDurations(
  world: World,
  durations: Partial<Record<TimedPhase, number>>
): World {
  const next = { ...world.phaseClock.durations };
  for (const phase of Object.keys(next) as TimedPhase[]) {
    const value = durations[phase];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      next[phase] = Math.round(value);
    }
  }
  return { ...world, phaseClock: { ...world.phaseClock, durations: next } };
}

/** Back to the entrance with nobody in the square; durations and models stay. */
export function restartWorld(world: World): World {
  const fresh = createWorld({
    seed: world.rng,
    bonecos: 0,
    map: world.map,
    rules: world.rules,
  });
  return {
    ...fresh,
    models: world.models,
    phaseClock: { ...fresh.phaseClock, durations: world.phaseClock.durations },
  };
}

/** While paused, every open question keeps the time it had left. */
function holdQuestions(world: World, elapsedMs: number): World {
  return {
    ...world,
    bonecos: world.bonecos.map((boneco) =>
      boneco.ask
        ? {
            ...boneco,
            ask: {
              ...boneco.ask,
              deadlineMs: boneco.ask.deadlineMs + elapsedMs,
              capMs: boneco.ask.capMs + elapsedMs,
            },
          }
        : boneco
    ),
  };
}

/** The world's step with the phase clock: the one the server runs. */
export function tick(
  world: World,
  input: { elapsedMs: number; models?: string[]; results?: BrainResult[] }
): { requests: DecisionRequest[]; world: World } {
  const { paused } = world.phaseClock;
  const stepped = step(
    paused ? holdQuestions(world, input.elapsedMs) : world,
    input
  );
  let next = stepped.world;
  if (!paused) {
    next = {
      ...next,
      phaseClock: {
        ...next.phaseClock,
        elapsedMs: next.phaseClock.elapsedMs + input.elapsedMs,
      },
    };
    const { remainingMs } = phaseStatus(next);
    if (remainingMs === 0) {
      next = advancePhase(next);
    }
  }
  return { world: next, requests: stepped.requests };
}
