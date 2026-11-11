import { describe, expect, test } from "bun:test";
import { expel } from "./admin";
import { DEFAULT_REFRAIN, desfileView } from "./desfile";
import {
  advancePhase,
  restartWorld,
  setPaused,
  setPhaseDurations,
  tick,
} from "./phases";
import { type Bloco, createWorld, type World } from "./world";

const TICK_MS = 100;

function run(world: World, ms: number): World {
  let current = world;
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    current = tick(current, { elapsedMs: TICK_MS }).world;
  }
  return current;
}

/**
 * A world at the end of the compor phase with `sizes` blocos. The first
 * bloco has a name and a refrain, as the compor phase leaves them; the
 * others have none, as when that phase is not there yet.
 */
function composed(sizes: number[]): World {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const world = createWorld({ seed: 3, bonecos: total });
  let next = 0;
  const blocos: Bloco[] = sizes.map((size, mark) => {
    const members = world.bonecos.slice(next, next + size).map((b) => b.id);
    next += size;
    return {
      id: `bloco-${mark + 1}`,
      mark,
      members,
      spot: { id: null, x: 10, y: 10 },
      formedBy: "maestro",
      ...(mark === 0
        ? {
            name: "Sombrinha Elétrica",
            refrain: ["Lá vem a sombrinha", "Girando no ar"],
          }
        : {}),
    };
  });
  const bonecos = world.bonecos.map((boneco, index) => ({
    ...boneco,
    blocoId: blocos.find((bloco) => bloco.members.includes(boneco.id))?.id,
    assignedModel: index % 2 === 0 ? "modelo-a" : "modelo-b",
    model: index === 0 ? "modelo-c" : null,
    sessionId: `sessao-${index + 1}`,
  }));
  return {
    ...world,
    blocos,
    bonecos: bonecos.map((boneco) => ({
      ...boneco,
      blocoId: boneco.blocoId ?? null,
    })),
    phase: "compor",
  };
}

function paraded(sizes: number[]): World {
  return advancePhase(composed(sizes));
}

describe("the desfile", () => {
  test("entering the desfile puts the first bloco on stage, with its name, refrain, members and models", () => {
    const world = paraded([3, 3]);
    const view = desfileView(world);
    expect(world.phase).toBe("desfile");
    expect(view?.current).toBe(0);
    const first = view?.blocos[0];
    expect(first).toMatchObject({
      id: "bloco-1",
      name: "Sombrinha Elétrica",
      refrain: ["Lá vem a sombrinha", "Girando no ar"],
      chosen: false,
      placement: null,
    });
    expect(first?.members.map((member) => member.id)).toEqual([
      "boneco-1",
      "boneco-2",
      "boneco-3",
    ]);
    expect(first?.members[0]?.models).toEqual(["modelo-c", "modelo-a"]);
    expect(first?.models).toEqual(["modelo-c", "modelo-a", "modelo-b"]);
  });

  test("a bloco without a name or a refrain parades as Bloco N with the default refrain", () => {
    const view = desfileView(paraded([3, 3]));
    expect(view?.blocos[1]).toMatchObject({
      name: "Bloco 2",
      refrain: DEFAULT_REFRAIN,
    });
    expect(DEFAULT_REFRAIN.length).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_REFRAIN.length).toBeLessThanOrEqual(4);
  });

  test("there is no desfile before the phase", () => {
    expect(desfileView(composed([3]))).toBeNull();
  });
});
