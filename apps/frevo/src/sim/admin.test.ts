import { describe, expect, test } from "bun:test";
import { BONECO_REMOVED_HOOKS, expel, setSilenced } from "./admin";
import { logEvent } from "./events";
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
    ({ world } = step(world, { elapsedMs: 100 }));
    expect(speechOf(world, "boneco-1")).toBeNull();
    world = setSilenced(world, "boneco-1", false);
    expect(speechOf(world, "boneco-1")).toBe("Bora pro coreto!");
  });

  test("a silenced boneco's lines leave the telão's event log too, and only those", () => {
    let world = createWorld({ seed: 1, bonecos: 2 });
    world = logEvent(world, "Bloco 1 formado: Ana e Bia.");
    world = logEvent(world, "Ana: bora pro coreto!", "boneco-1");
    world = logEvent(world, "Bia: frevo é vida!", "boneco-2");
    const texts = () => publicSnapshot(world).events.map((event) => event.text);
    expect(texts()).toEqual([
      "Bloco 1 formado: Ana e Bia.",
      "Ana: bora pro coreto!",
      "Bia: frevo é vida!",
    ]);
    world = setSilenced(world, "boneco-1", true);
    expect(texts()).toEqual([
      "Bloco 1 formado: Ana e Bia.",
      "Bia: frevo é vida!",
    ]);
    ({ world } = step(world, { elapsedMs: 100 }));
    expect(texts()).not.toContain("Ana: bora pro coreto!");
    world = setSilenced(world, "boneco-1", false);
    expect(texts()).toContain("Ana: bora pro coreto!");
  });

  test("an expelled boneco leaves the world and its phone no longer finds it", () => {
    let world = createWorld({ seed: 1, bonecos: 1 });
    const joined = join(world, { sessionId: "sessao-1" });
    ({ world } = joined);
    const result = expel(world, joined.bonecoId as string);
    expect(result.sessionId).toBe("sessao-1");
    ({ world } = result);
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
