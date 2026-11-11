import { describe, expect, test } from "bun:test";
import { BONECO_REMOVED_HOOKS, expel, setSilenced } from "./admin";
import {
  createWorld,
  join,
  privateView,
  publicSnapshot,
  step,
  type World,
} from "./world";

function speaking(): World {
  const world = createWorld({ seed: 3, bonecos: 2 });
  const { requests, world: asked } = step(world, { elapsedMs: 100 });
  const request = requests.find((item) => item.boneco.id === "boneco-1");
  return step(asked, {
    elapsedMs: 100,
    results: [
      {
        requestId: request?.id ?? "",
        ok: true,
        model: "modelo-a",
        action: { type: "walk", placeId: "coreto", speech: "Bora pro coreto!" },
      },
    ],
  }).world;
}

function speechOf(world: World, id: string) {
  return publicSnapshot(world).bonecos.find((boneco) => boneco.id === id)
    ?.speech;
}

describe("moderation", () => {
  test("a silenced boneco's lines disappear from the telão and come back when allowed", () => {
    let world = speaking();
    expect(speechOf(world, "boneco-1")).toBe("Bora pro coreto!");
    world = setSilenced(world, "boneco-1", true);
    expect(speechOf(world, "boneco-1")).toBeNull();
    world = step(world, { elapsedMs: 100 }).world;
    expect(speechOf(world, "boneco-1")).toBeNull();
    world = setSilenced(world, "boneco-1", false);
    expect(speechOf(world, "boneco-1")).toBe("Bora pro coreto!");
  });

  test("an expelled boneco leaves the world and its phone no longer finds it", () => {
    let world = createWorld({ seed: 1, bonecos: 1 });
    let bonecoId = "";
    ({ world, bonecoId } = join(world, { sessionId: "sessao-1" }));
    const result = expel(world, bonecoId);
    expect(result.sessionId).toBe("sessao-1");
    world = result.world;
    expect(publicSnapshot(world).bonecos.map((boneco) => boneco.id)).toEqual([
      "boneco-1",
    ]);
    expect(privateView(world, "sessao-1")).toBeNull();
  });

  test("expelling also lets the phases drop the boneco from what they keep", () => {
    const removed: string[] = [];
    BONECO_REMOVED_HOOKS.push((world, bonecoId) => {
      removed.push(bonecoId);
      return world;
    });
    try {
      expel(createWorld({ seed: 1, bonecos: 2 }), "boneco-2");
      expect(removed).toEqual(["boneco-2"]);
    } finally {
      BONECO_REMOVED_HOOKS.pop();
    }
  });

  test("expelling someone who is not there changes nothing", () => {
    const world = createWorld({ seed: 1, bonecos: 1 });
    expect(expel(world, "boneco-9")).toEqual({ world, sessionId: null });
  });
});
