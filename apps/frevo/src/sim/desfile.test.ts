import { describe, expect, test } from "bun:test";
import { expel } from "./admin";
import {
  DEFAULT_REFRAIN,
  desfileView,
  MAX_CHOSEN,
  nextBloco,
  phoneDesfile,
  previousBloco,
  setChosen,
} from "./desfile";
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
  const blocos: Bloco[] = sizes.map((size, index) => {
    const members = world.bonecos.slice(next, next + size).map((b) => b.id);
    next += size;
    return {
      id: `bloco-${index + 1}`,
      mark: index,
      members,
      spot: { id: null, x: 10, y: 10 },
      formedBy: "maestro",
      name: index === 0 ? "Sombrinha Elétrica" : null,
      refrain: index === 0 ? ["Lá vem a sombrinha", "Girando no ar"] : null,
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

/** The world after the host marks or unmarks a bloco. */
function mark(world: World, blocoId: string, chosen: boolean): World {
  const { world: next } = setChosen(world, blocoId, chosen);
  return next;
}

function expelled(world: World, bonecoId: string): World {
  const { world: next } = expel(world, bonecoId);
  return next;
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

  test("each bloco gets an equal share of the phase, then the next one goes on stage", () => {
    // Three blocos in three minutes: one minute each.
    let world = paraded([3, 3, 3]);
    world = run(world, 59_000);
    expect(desfileView(world)?.current).toBe(0);
    expect(desfileView(world)?.currentRemainingMs).toBe(1000);
    world = run(world, 2000);
    expect(desfileView(world)?.current).toBe(1);
    world = run(world, 60_000);
    expect(desfileView(world)?.current).toBe(2);
  });

  test("the share follows the duration the host sets", () => {
    const world = run(
      setPhaseDurations(paraded([3, 3]), { desfile: 60_000 }),
      31_000
    );
    expect(desfileView(world)).toMatchObject({ slotMs: 30_000, current: 1 });
  });

  test("a pause holds the bloco on stage", () => {
    const world = run(setPaused(paraded([3, 3]), true), 200_000);
    expect(desfileView(world)?.current).toBe(0);
  });

  test("the host moves to the next bloco and back, and the new one gets a full share", () => {
    let world = run(paraded([3, 3, 3]), 30_000);
    world = nextBloco(world);
    expect(desfileView(world)).toMatchObject({
      current: 1,
      currentRemainingMs: 60_000,
    });
    world = run(world, 40_000);
    expect(desfileView(world)?.current).toBe(1);
    world = previousBloco(world);
    expect(desfileView(world)?.current).toBe(0);
  });

  test("there is nothing before the first bloco or after the last", () => {
    let world = previousBloco(paraded([3, 3]));
    expect(desfileView(world)?.current).toBe(0);
    world = nextBloco(nextBloco(nextBloco(world)));
    expect(desfileView(world)?.current).toBe(1);
  });

  test("when the time is up the final comes, with no bloco on stage", () => {
    const world = run(paraded([3, 3]), 181_000);
    expect(world.phase).toBe("final");
    expect(desfileView(world)).toMatchObject({ phase: "final", current: null });
    expect(desfileView(world)?.blocos.map((bloco) => bloco.id)).toEqual([
      "bloco-1",
      "bloco-2",
    ]);
  });
});

describe("the jury", () => {
  test("the host marks up to three blocos, and the order of marking is the placement", () => {
    let world = paraded([3, 3, 3, 3]);
    for (const id of ["bloco-3", "bloco-1", "bloco-4"]) {
      const marked = setChosen(world, id, true);
      expect(marked.error).toBeUndefined();
      ({ world } = marked);
    }
    const refused = setChosen(world, "bloco-2", true);
    expect(refused.error).toBe(`Já há ${MAX_CHOSEN} blocos escolhidos.`);
    expect(refused.world).toBe(world);
    const view = desfileView(world);
    expect(view?.chosen).toEqual(["bloco-3", "bloco-1", "bloco-4"]);
    expect(view?.blocos.map((bloco) => bloco.placement)).toEqual([
      2,
      null,
      1,
      3,
    ]);
  });

  test("unmarking frees a place, and marking twice changes nothing", () => {
    let world = paraded([3, 3, 3, 3]);
    for (const id of ["bloco-1", "bloco-2", "bloco-2", "bloco-3"]) {
      world = mark(world, id, true);
    }
    world = mark(world, "bloco-1", false);
    const marked = setChosen(world, "bloco-4", true);
    expect(marked.error).toBeUndefined();
    expect(desfileView(marked.world)?.chosen).toEqual([
      "bloco-2",
      "bloco-3",
      "bloco-4",
    ]);
  });

  test("the host may still mark in the final, but not before the desfile or an unknown bloco", () => {
    expect(setChosen(composed([3]), "bloco-1", true).error).toBe(
      "O júri só escolhe no desfile e no final."
    );
    expect(setChosen(paraded([3]), "bloco-9", true).error).toBe(
      "Bloco não encontrado."
    );
    const final = advancePhase(paraded([3, 3]));
    expect(desfileView(mark(final, "bloco-2", true))?.chosen).toEqual([
      "bloco-2",
    ]);
  });

  test("the final announces the chosen blocos", () => {
    let world = mark(paraded([3, 3]), "bloco-2", true);
    world = advancePhase(world);
    expect(world.events.at(-1)?.text).toBe(
      "Fim do desfile! Escolhidos do júri: Bloco 2."
    );
  });

  test("a bloco emptied by the host leaves the parade and the choices", () => {
    let world = mark(paraded([1, 3]), "bloco-1", true);
    world = expelled(world, "boneco-1");
    const view = desfileView(world);
    expect(view?.blocos.map((bloco) => bloco.id)).toEqual(["bloco-2"]);
    expect(view?.chosen).toEqual([]);
  });

  test("restarting forgets the desfile and the choices", () => {
    let world = mark(paraded([3, 3]), "bloco-1", true);
    world = restartWorld(advancePhase(world));
    expect(world.phase).toBe("entrada");
    expect(world.desfile).toBeNull();
    expect(desfileView(world)).toBeNull();
  });
});

describe("the phone in the desfile", () => {
  test("shows the refrain of its own bloco and whether it is on stage", () => {
    const world = paraded([3, 3]);
    expect(phoneDesfile(world, "boneco-1")).toEqual({
      phase: "desfile",
      name: "Sombrinha Elétrica",
      refrain: ["Lá vem a sombrinha", "Girando no ar"],
      onStage: true,
      chosen: false,
      placement: null,
    });
    expect(phoneDesfile(world, "boneco-4")).toMatchObject({
      name: "Bloco 2",
      onStage: false,
    });
  });

  test("in the final, shows whether its bloco was chosen", () => {
    let world = mark(paraded([3, 3]), "bloco-2", true);
    world = advancePhase(world);
    expect(phoneDesfile(world, "boneco-4")).toMatchObject({
      phase: "final",
      chosen: true,
      placement: 1,
      onStage: false,
    });
    expect(phoneDesfile(world, "boneco-1")).toMatchObject({
      chosen: false,
      placement: null,
    });
  });

  test("shows nothing before the desfile or to a boneco without a bloco", () => {
    expect(phoneDesfile(composed([3]), "boneco-1")).toBeNull();
    expect(phoneDesfile(paraded([3]), "boneco-9")).toBeNull();
  });
});
