import { describe, expect, test } from "bun:test";
import {
  advancePhase,
  DEFAULT_PHASE_DURATIONS,
  PHASE_HOOKS,
  phaseStatus,
  restartWorld,
  setPaused,
  setPhaseDurations,
  tick,
} from "./phases";
import {
  answerHuman,
  createWorld,
  join,
  privateView,
  publicSnapshot,
  type World,
} from "./world";

const TICK_MS = 100;

function run(world: World, ms: number): World {
  let current = world;
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    current = tick(current, { elapsedMs: TICK_MS }).world;
  }
  return current;
}

function started(): World {
  return advancePhase(createWorld({ seed: 1, bonecos: 0 }));
}

describe("the phases of the dynamic", () => {
  test("the default durations are two and a half, two and a half and three minutes", () => {
    expect(DEFAULT_PHASE_DURATIONS).toEqual({
      formar: 150_000,
      compor: 150_000,
      desfile: 180_000,
    });
  });

  test("the entrance waits for the host: no clock, no automatic advance", () => {
    const world = run(createWorld({ seed: 1, bonecos: 0 }), 600_000);
    expect(phaseStatus(world)).toMatchObject({
      phase: "entrada",
      paused: false,
      durationMs: null,
      remainingMs: null,
    });
  });

  test("advancing goes through the phases in order and stops at the final", () => {
    let world = createWorld({ seed: 1, bonecos: 0 });
    const seen = [world.phase];
    for (let index = 0; index < 5; index += 1) {
      world = advancePhase(world);
      seen.push(world.phase);
    }
    expect(seen).toEqual([
      "entrada",
      "formar",
      "compor",
      "desfile",
      "final",
      "final",
    ]);
  });

  test("a timed phase counts down and the next starts when the time is up", () => {
    let world = run(started(), 60_000);
    expect(phaseStatus(world)).toMatchObject({
      phase: "formar",
      durationMs: 150_000,
      remainingMs: 90_000,
    });
    world = run(world, 90_000);
    expect(phaseStatus(world)).toMatchObject({
      phase: "compor",
      remainingMs: 150_000,
    });
    world = run(world, 150_000 + 180_000);
    expect(phaseStatus(world)).toMatchObject({
      phase: "final",
      paused: false,
      durationMs: null,
      remainingMs: null,
    });
  });

  test("pausing freezes the phase clock while the bonecos keep walking", () => {
    let world = run(advancePhase(createWorld({ seed: 2, bonecos: 3 })), 10_000);
    world = setPaused(world, true);
    const before = publicSnapshot(world).bonecos.map(({ x, y }) => [x, y]);
    world = run(world, 400_000);
    expect(phaseStatus(world)).toMatchObject({
      phase: "formar",
      paused: true,
      remainingMs: 140_000,
    });
    expect(publicSnapshot(world).bonecos.map(({ x, y }) => [x, y])).not.toEqual(
      before
    );
    world = run(setPaused(world, false), 40_000);
    expect(phaseStatus(world)).toMatchObject({
      paused: false,
      remainingMs: 100_000,
    });
  });

  test("pausing freezes the countdown of a question to the human", () => {
    let world = createWorld({ seed: 1, bonecos: 0 });
    ({ world } = join(world, { sessionId: "sessao-1" }));
    // No model answers: the boneco asks a question from its own list.
    world = run(world, 9000);
    const asked = privateView(world, "sessao-1")?.ask;
    expect(asked).not.toBeNull();
    world = run(setPaused(world, true), 60_000);
    const frozen = privateView(world, "sessao-1")?.ask;
    expect(frozen?.id).toBe(asked?.id);
    expect(frozen?.remainingMs).toBe(asked?.remainingMs);
    const answered = answerHuman(world, {
      sessionId: "sessao-1",
      askId: frozen?.id ?? "",
      choice: 0,
    });
    expect(answered.error).toBeUndefined();
  });

  test("durations change before the dynamic and during a phase", () => {
    let world = setPhaseDurations(createWorld({ seed: 1, bonecos: 0 }), {
      formar: 60_000,
    });
    world = run(advancePhase(world), 20_000);
    expect(phaseStatus(world)).toMatchObject({
      durationMs: 60_000,
      remainingMs: 40_000,
    });
    world = setPhaseDurations(world, { formar: 120_000, desfile: 30_000 });
    expect(phaseStatus(world).remainingMs).toBe(100_000);
    // Shortening below what already passed ends the phase on the next step.
    world = run(setPhaseDurations(world, { formar: 10_000 }), TICK_MS);
    expect(phaseStatus(world).phase).toBe("compor");
    world = run(advancePhase(world), 0);
    expect(phaseStatus(world).durationMs).toBe(30_000);
  });

  test("a duration that is not a positive number of milliseconds is ignored", () => {
    const world = setPhaseDurations(createWorld({ seed: 1, bonecos: 0 }), {
      formar: -5,
      compor: Number.NaN,
    });
    expect(phaseStatus(world).durations).toEqual(DEFAULT_PHASE_DURATIONS);
  });

  test("restarting goes back to the entrance with nobody, keeping the durations", () => {
    let world = createWorld({ seed: 1, bonecos: 4 });
    ({ world } = join(world, { sessionId: "sessao-1" }));
    world = setPhaseDurations(world, { compor: 90_000 });
    world = setPaused(run(advancePhase(advancePhase(world)), 5000), true);
    world = restartWorld(world);
    expect(publicSnapshot(world).bonecos).toEqual([]);
    expect(phaseStatus(world)).toMatchObject({
      phase: "entrada",
      paused: false,
      durationMs: null,
      remainingMs: null,
    });
    expect(phaseStatus(world).durations.compor).toBe(90_000);
    expect(privateView(world, "sessao-1")).toBeNull();
  });

  test("the formar phase opens when the dynamic starts and closes when its time is up", () => {
    let world = started();
    expect(world.phase).toBe("formar");
    expect(world.formar?.open).toBe(true);
    expect(world.events.at(-1)?.text).toContain("Hora de formar os blocos");
    // Three bonecos without a model: nobody meets, so the end groups them.
    world = advancePhase(createWorld({ seed: 1, bonecos: 3 }));
    world = run(setPhaseDurations(world, { formar: 1000 }), 1000);
    expect(world.phase).toBe("compor");
    expect(world.formar?.open).toBe(false);
    expect(world.blocos).toHaveLength(1);
    expect(publicSnapshot(world).bonecos.every((b) => b.bloco !== null)).toBe(
      true
    );
  });

  test("restarting empties the blocos and the event log, and the formar phase opens again", () => {
    let world = advancePhase(createWorld({ seed: 1, bonecos: 3 }));
    world = advancePhase(world);
    expect(world.blocos).toHaveLength(1);
    expect(world.events.length).toBeGreaterThan(0);
    world = restartWorld(world);
    expect(world.blocos).toEqual([]);
    expect(world.events).toEqual([]);
    expect(world.formar).toBeNull();
    expect(publicSnapshot(world)).toMatchObject({ blocos: [], events: [] });
    ({ world } = join(world, { sessionId: "sessao-1" }));
    world = advancePhase(world);
    expect(world.formar?.open).toBe(true);
    expect(world.events.map((event) => event.text)).toEqual([
      "Hora de formar os blocos! Os bonecos vão se conhecer.",
    ]);
  });

  test("phases run their hooks when they start and when they end", () => {
    const calls: string[] = [];
    const original = PHASE_HOOKS.compor;
    PHASE_HOOKS.compor = {
      onEnter: (world) => {
        calls.push(`enter ${world.phase}`);
        return world;
      },
      onExit: (world) => {
        calls.push(`exit ${world.phase}`);
        return world;
      },
    };
    try {
      let world = run(started(), 150_000);
      world = advancePhase(world);
      expect(world.phase).toBe("desfile");
      expect(calls).toEqual(["enter compor", "exit compor"]);
    } finally {
      PHASE_HOOKS.compor = original;
    }
  });
});
