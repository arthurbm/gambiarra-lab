import { describe, expect, test } from "bun:test";
import {
  type BrainResult,
  createWorld,
  type DecisionRequest,
  publicSnapshot,
  step,
  type WalkRequest,
  type World,
} from "./world";

const TICK_MS = 100;

/** Runs the world for `ms` of fake time, feeding `brain` every request. */
function run(
  world: World,
  ms: number,
  brain: (request: DecisionRequest) => BrainResult | undefined = () => undefined
) {
  let current = world;
  let results: BrainResult[] = [];
  const requests: DecisionRequest[] = [];
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) {
    const next = step(current, { elapsedMs: TICK_MS, results });
    current = next.world;
    requests.push(...next.requests);
    results = next.requests.flatMap((request) => brain(request) ?? []);
  }
  return { world: current, requests };
}

/** Steps the world without a brain until `done`, for at most a fake minute. */
function runUntil(world: World, done: (world: World) => boolean) {
  let current = world;
  for (
    let elapsed = 0;
    elapsed < 60_000 && !done(current);
    elapsed += TICK_MS
  ) {
    current = step(current, { elapsedMs: TICK_MS }).world;
  }
  return current;
}

function onlyBoneco(world: World) {
  const [boneco] = publicSnapshot(world).bonecos;
  if (!boneco) {
    throw new Error("the world has no boneco");
  }
  return boneco;
}

describe("a boneco deciding by a brain", () => {
  test("asks for a decision, then walks to the chosen place saying its line", () => {
    const start = createWorld({ seed: 1, bonecos: 1 });
    const fonte = start.map.places.find((place) => place.id === "fonte");
    if (!fonte) {
      throw new Error("the map has no fonte");
    }

    const asked = step(start, { elapsedMs: TICK_MS });
    expect(asked.requests).toHaveLength(1);
    const [request] = asked.requests as [WalkRequest];
    expect(onlyBoneco(asked.world).thinking).toBe(true);
    expect(request.places.map((place) => place.id)).toContain("fonte");

    const decided = step(asked.world, {
      elapsedMs: TICK_MS,
      results: [
        {
          requestId: request.id,
          ok: true,
          action: {
            type: "walk",
            placeId: "fonte",
            speech: "Vou até a fonte!",
          },
          model: "modelo-a",
        },
      ],
    });
    const walking = onlyBoneco(decided.world);
    expect(walking.thinking).toBe(false);
    expect(walking.walking).toBe(true);
    expect(walking.speech).toBe("Vou até a fonte!");
    expect(walking.brain).toBe("model");
    expect(walking.model).toBe("modelo-a");

    const arrived = onlyBoneco(
      runUntil(decided.world, (world) => !onlyBoneco(world).walking)
    );
    expect(arrived.x).toBeCloseTo(fonte.x, 5);
    expect(arrived.y).toBeCloseTo(fonte.y, 5);
  });
});

describe("a boneco whose brain does not answer", () => {
  test("goes on autopilot after the deadline and ignores the late answer", () => {
    const start = createWorld({
      seed: 7,
      bonecos: 1,
      rules: { decisionTimeoutMs: 3000 },
    });
    const asked = step(start, { elapsedMs: TICK_MS });
    const [request] = asked.requests as [DecisionRequest];
    const origin = onlyBoneco(asked.world);

    const waiting = onlyBoneco(run(asked.world, 2900).world);
    expect(waiting.thinking).toBe(true);
    expect(waiting.walking).toBe(false);

    const afterDeadline = run(asked.world, 3100).world;
    const onAutopilot = onlyBoneco(afterDeadline);
    expect(onAutopilot.thinking).toBe(false);
    expect(onAutopilot.walking).toBe(true);
    expect(onAutopilot.brain).toBe("autopilot");
    expect(onAutopilot.model).toBeNull();
    expect(onAutopilot.speech).toBeNull();

    const late = step(afterDeadline, {
      elapsedMs: TICK_MS,
      results: [
        {
          requestId: request.id,
          ok: true,
          action: { type: "walk", placeId: "fonte", speech: "Cheguei tarde" },
        },
      ],
    });
    expect(onlyBoneco(late.world).brain).toBe("autopilot");
    expect(onlyBoneco(late.world).speech).toBeNull();

    const moved = onlyBoneco(run(late.world, 1000).world);
    expect(Math.hypot(moved.x - origin.x, moved.y - origin.y)).toBeGreaterThan(
      5
    );
  });
});

describe("a boneco whose brain answers badly", () => {
  test("goes on autopilot at once when the brain reports a failure", () => {
    const asked = step(createWorld({ seed: 3, bonecos: 1 }), {
      elapsedMs: TICK_MS,
    });
    const [request] = asked.requests as [DecisionRequest];
    const failed = step(asked.world, {
      elapsedMs: TICK_MS,
      results: [{ requestId: request.id, ok: false, reason: "no tool call" }],
    });
    const boneco = onlyBoneco(failed.world);
    expect(boneco.thinking).toBe(false);
    expect(boneco.walking).toBe(true);
    expect(boneco.brain).toBe("autopilot");
  });

  test("goes on autopilot when the brain picks a place that does not exist", () => {
    const asked = step(createWorld({ seed: 3, bonecos: 1 }), {
      elapsedMs: TICK_MS,
    });
    const [request] = asked.requests as [DecisionRequest];
    const decided = step(asked.world, {
      elapsedMs: TICK_MS,
      results: [
        {
          requestId: request.id,
          ok: true,
          action: {
            type: "walk",
            placeId: "olinda",
            speech: "Bora pra Olinda",
          },
        },
      ],
    });
    const boneco = onlyBoneco(decided.world);
    expect(boneco.brain).toBe("autopilot");
    expect(boneco.walking).toBe(true);
    expect(boneco.speech).toBeNull();
  });
});

describe("what a boneco says", () => {
  function sayAtFonte(speech: string) {
    const asked = step(
      createWorld({
        seed: 5,
        bonecos: 1,
        rules: { speechMs: 4000, speechMaxLength: 20 },
      }),
      { elapsedMs: TICK_MS }
    );
    const [request] = asked.requests as [DecisionRequest];
    return step(asked.world, {
      elapsedMs: TICK_MS,
      results: [
        {
          requestId: request.id,
          ok: true,
          action: { type: "walk", placeId: "fonte", speech },
        },
      ],
    }).world;
  }

  test("stays in the balloon for a while, then goes away", () => {
    const spoke = sayAtFonte("Eita, que calor!");
    expect(onlyBoneco(run(spoke, 3800).world).speech).toBe("Eita, que calor!");
    expect(onlyBoneco(run(spoke, 4100).world).speech).toBeNull();
  });

  test("is cut to the balloon's size", () => {
    const spoke = sayAtFonte("Vou atravessar a ponte até o coreto agora mesmo");
    expect(onlyBoneco(spoke).speech).toHaveLength(20);
  });
});

describe("the world over time", () => {
  test("asks again from the place the boneco arrived at", () => {
    const { requests } = run(
      createWorld({ seed: 2, bonecos: 1 }),
      60_000,
      (request) => ({
        requestId: request.id,
        ok: true,
        action: {
          type: "walk",
          placeId:
            (request as WalkRequest).placeId === "palco" ? "coreto" : "palco",
          speech: "Simbora",
        },
      })
    );
    const walks = requests as WalkRequest[];
    expect(walks.length).toBeGreaterThan(2);
    expect(walks[0]?.placeId).toBeNull();
    expect(walks[1]?.placeId).toBe("palco");
    expect(walks[2]?.placeId).toBe("coreto");
    expect(new Set(requests.map((request) => request.id)).size).toBe(
      requests.length
    );
  });

  test("is the same for the same seed and inputs, and never changes its input", () => {
    const start = createWorld({ seed: 11, bonecos: 4 });
    const frozen = structuredClone(start);
    const first = publicSnapshot(run(start, 30_000).world);
    const second = publicSnapshot(run(start, 30_000).world);
    expect(second).toEqual(first);
    expect(start).toEqual(frozen);

    const other = publicSnapshot(
      run(createWorld({ seed: 12, bonecos: 4 }), 30_000).world
    );
    expect(other).not.toEqual(first);
  });

  test("keeps every boneco inside the map, each with its own decisions", () => {
    const start = createWorld({ seed: 4, bonecos: 6 });
    const { world, requests } = run(start, 45_000);
    const snapshot = publicSnapshot(world);
    expect(snapshot.bonecos).toHaveLength(6);
    expect(new Set(snapshot.bonecos.map((boneco) => boneco.id)).size).toBe(6);
    for (const boneco of snapshot.bonecos) {
      expect(boneco.x).toBeGreaterThanOrEqual(0);
      expect(boneco.x).toBeLessThanOrEqual(snapshot.map.width);
      expect(boneco.y).toBeGreaterThanOrEqual(0);
      expect(boneco.y).toBeLessThanOrEqual(snapshot.map.height);
    }
    expect(new Set(requests.map((request) => request.boneco.id)).size).toBe(6);
  });
});

describe("the model a boneco thinks with", () => {
  test("shows which model answered next to the one the boneco was given", () => {
    // The Room has one model: the boneco is given it, and asks for it.
    const asked = step(createWorld({ seed: 3, bonecos: 1 }), {
      elapsedMs: TICK_MS,
      models: ["modelo-a"],
    });
    const [request] = asked.requests;
    expect(request?.model).toBe("modelo-a");
    const answered = step(asked.world, {
      elapsedMs: TICK_MS,
      results: [
        {
          requestId: request?.id as string,
          ok: true,
          action: { type: "walk", placeId: "fonte", speech: "Bora" },
          model: "modelo-b",
        },
      ],
    });
    expect(onlyBoneco(answered.world)).toMatchObject({
      assignedModel: "modelo-a",
      model: "modelo-b",
      brain: "model",
    });
  });

  test("tells for how long a boneco has been thinking", () => {
    const start = createWorld({ seed: 3, bonecos: 1 });
    expect(onlyBoneco(start).thinkingForMs).toBeNull();
    const asked = step(start, { elapsedMs: TICK_MS }).world;
    const waiting = run(asked, 900).world;
    expect(onlyBoneco(waiting)).toMatchObject({
      thinking: true,
      thinkingForMs: 900,
    });
  });
});
