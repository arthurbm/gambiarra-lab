import { describe, expect, test } from "bun:test";
import { openAsk } from "../sim/ask";
import { advancePhase, tick } from "../sim/phases";
import {
  createWorld,
  join,
  privateView,
  publicSnapshot,
  type World,
  type WorldMap,
} from "../sim/world";
import { createSimulatedHumans, type SimulatedHumans } from "./simulated";

const TICK_MS = 100;

function run(world: World, humans: SimulatedHumans, ms: number): World {
  let current = world;
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    current = humans.act(tick(current, { elapsedMs: TICK_MS }).world);
  }
  return current;
}

describe("simulated humans", () => {
  test("fill the square up to a total, arriving the way a person does", () => {
    const humans = createSimulatedHumans({ seed: 1 });
    let world = createWorld({ seed: 1, bonecos: 0 });
    ({ world } = join(world, { sessionId: "pessoa-real-1" }));
    const filled = humans.fill(world, 25);
    expect(filled.added).toBe(24);
    ({ world } = filled);
    expect(publicSnapshot(world).bonecos).toHaveLength(25);
    const simulated = world.bonecos.filter(
      (boneco) => boneco.sessionId && humans.isSimulated(boneco.sessionId)
    );
    expect(simulated).toHaveLength(24);
    // Each one has a phone view, like a person who scanned the QR.
    for (const boneco of simulated) {
      expect(privateView(world, boneco.sessionId ?? "")).not.toBeNull();
    }
    expect(humans.fill(world, 10).added).toBe(0);
  });

  test("answer their interview after a human delay, and usually in time", () => {
    const humans = createSimulatedHumans({ seed: 7 });
    let { world } = humans.fill(createWorld({ seed: 2, bonecos: 0 }), 12);
    const sessions = world.bonecos.map((boneco) => boneco.sessionId ?? "");
    const firstAsk = new Map<string, { id: string; atMs: number }>();
    const answeredAt: number[] = [];
    for (let elapsed = 0; elapsed < 90_000; elapsed += TICK_MS) {
      ({ world } = tick(world, { elapsedMs: TICK_MS }));
      for (const session of sessions) {
        const ask = privateView(world, session)?.ask;
        if (ask && !firstAsk.has(session)) {
          firstAsk.set(session, { id: ask.id, atMs: world.timeMs });
        }
      }
      world = humans.act(world);
      for (const session of sessions) {
        const first = firstAsk.get(session);
        const view = privateView(world, session);
        if (first && view?.ask?.id !== first.id && first.atMs >= 0) {
          answeredAt.push(world.timeMs - first.atMs);
          firstAsk.set(session, { ...first, atMs: -1 });
        }
      }
    }
    // Everyone went through the interview, mostly by their own hand.
    const views = sessions.map((session) => privateView(world, session));
    expect(views.every((view) => view?.interview?.done)).toBe(true);
    const alone = views.flatMap((view) =>
      (view?.thoughts ?? []).filter((thought) =>
        thought.text.startsWith("O tempo acabou")
      )
    );
    expect(alone.length).toBeLessThan(sessions.length * 2);
    // Not instant and not all alike.
    expect(Math.min(...answeredAt)).toBeGreaterThanOrEqual(1000);
    expect(new Set(answeredAt).size).toBeGreaterThan(3);
  });

  test("answer any question without knowing what it is for", () => {
    const humans = createSimulatedHumans({ seed: 3 });
    let { world } = humans.fill(createWorld({ seed: 4, bonecos: 0 }), 1);
    const [boneco] = world.bonecos;
    // A vote some later phase might open: an unknown purpose.
    world = {
      ...world,
      bonecos: [
        {
          ...(boneco as World["bonecos"][number]),
          interview: null,
          ask: openAsk(
            {
              purpose: "algo-que-ainda-nao-existe",
              question: "Qual nome?",
              options: ["Bloco A", "Bloco B", "Bloco C"],
            },
            "boneco-1?99",
            world.timeMs,
            world.rules
          ),
        },
      ],
    };
    world = run(world, humans, 11_500);
    const [after] = world.bonecos;
    expect(after?.ask).toBeNull();
    expect(
      after?.thoughts.some((thought) => thought.text.startsWith("O tempo"))
    ).toBe(false);
  });

  test("answer the bloco invitations, and the formar phase ends with everyone in a bloco", () => {
    // Everyone on the same spot, so they meet; no model, so on autopilot.
    const roda: WorldMap = {
      width: 20,
      height: 20,
      places: [{ id: "roda", name: "Roda", x: 10, y: 10 }],
    };
    const humans = createSimulatedHumans({ seed: 5, silentShare: 0 });
    let { world } = humans.fill(
      createWorld({ seed: 5, bonecos: 0, map: roda }),
      7
    );
    world = run(world, humans, 90_000);
    expect(
      world.bonecos.every((boneco) => boneco.interview?.stage === "done")
    ).toBe(true);

    world = advancePhase(world);
    expect(world.phase).toBe("formar");
    // Each invitation, by id: its deadline and when it left the phone.
    const invitations = new Map<
      string,
      { closedAtMs?: number; deadlineMs: number }
    >();
    for (let elapsed = 0; elapsed < 60_000; elapsed += TICK_MS) {
      ({ world } = tick(world, { elapsedMs: TICK_MS }));
      world = humans.act(world);
      const open = new Set(world.bonecos.map((boneco) => boneco.ask?.id));
      for (const boneco of world.bonecos) {
        if (
          boneco.ask?.purpose === "bloco" &&
          !invitations.has(boneco.ask.id)
        ) {
          invitations.set(boneco.ask.id, { deadlineMs: boneco.ask.deadlineMs });
        }
      }
      for (const [id, invitation] of invitations) {
        if (invitation.closedAtMs === undefined && !open.has(id)) {
          invitation.closedAtMs = world.timeMs;
        }
      }
    }
    expect(invitations.size).toBeGreaterThan(0);
    // Every invitation closed before its countdown ran out: answered by hand.
    for (const invitation of invitations.values()) {
      expect(invitation.closedAtMs).toBeDefined();
      expect(invitation.closedAtMs ?? 0).toBeLessThan(invitation.deadlineMs);
    }

    world = run(advancePhase(world), humans, 1000);
    expect(world.phase).toBe("compor");
    expect(world.bonecos).toHaveLength(7);
    expect(world.bonecos.every((boneco) => boneco.blocoId !== null)).toBe(true);
  });

  test("are removed together, leaving the real people", () => {
    const humans = createSimulatedHumans({ seed: 1 });
    let world = createWorld({ seed: 1, bonecos: 0 });
    ({ world } = join(world, { sessionId: "pessoa-real-1" }));
    ({ world } = humans.fill(world, 6));
    const removed = humans.removeAll(world);
    expect(removed.removed).toBe(5);
    expect(removed.world.bonecos.map((other) => other.sessionId)).toEqual([
      "pessoa-real-1",
    ]);
  });
});
