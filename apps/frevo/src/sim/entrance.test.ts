import { describe, expect, test } from "bun:test";
import {
  createWorld,
  join,
  PHASES,
  privateView,
  publicSnapshot,
  step,
  type World,
} from "./world";

const TICK_MS = 100;

function joined(world: World, sessionId: string) {
  return join(world, { sessionId });
}

describe("the entrance", () => {
  test("the dynamic starts at the entrance, the first of five phases", () => {
    expect(PHASES).toEqual(["entrada", "formar", "compor", "desfile", "final"]);
    const world = createWorld({ seed: 1, bonecos: 0 });
    expect(publicSnapshot(world).phase).toBe("entrada");
  });

  test("a person who arrives gets a boneco with a name and a look on the telão", () => {
    const start = step(createWorld({ seed: 1, bonecos: 0 }), {
      elapsedMs: TICK_MS,
      models: ["modelo-a"],
    }).world;
    const { world, bonecoId } = joined(start, "sessao-1");
    const [boneco] = publicSnapshot(world).bonecos;
    expect(boneco?.id).toBe(bonecoId);
    expect(boneco?.name.length).toBeGreaterThan(0);
    expect(boneco?.look).toBeGreaterThanOrEqual(0);
    expect(boneco?.look).toBeLessThan(30);
    expect(boneco?.instrument).toBeNull();
    expect(privateView(world, "sessao-1")?.boneco.assignedModel).toBe(
      "modelo-a"
    );
  });

  test("the same session gets the same boneco back", () => {
    const start = createWorld({ seed: 1, bonecos: 0 });
    const first = joined(start, "sessao-1");
    const again = joined(first.world, "sessao-1");
    expect(again.bonecoId).toBe(first.bonecoId);
    expect(again.created).toBe(false);
    expect(publicSnapshot(again.world).bonecos).toHaveLength(1);
  });

  test("models are spread evenly and names and looks do not repeat", () => {
    let { world } = step(createWorld({ seed: 9, bonecos: 0 }), {
      elapsedMs: TICK_MS,
      models: ["modelo-a", "modelo-b", "modelo-c"],
    });
    for (let index = 1; index <= 9; index += 1) {
      ({ world } = joined(world, `sessao-${index}`));
    }
    const counts = new Map<string, number>();
    for (let index = 1; index <= 9; index += 1) {
      const model = privateView(world, `sessao-${index}`)?.boneco
        .assignedModel as string;
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
    expect([...counts.values()]).toEqual([3, 3, 3]);
    const { bonecos } = publicSnapshot(world);
    expect(new Set(bonecos.map((boneco) => boneco.name)).size).toBe(9);
    expect(new Set(bonecos.map((boneco) => boneco.look)).size).toBe(9);
  });

  test("a boneco that arrived before any model gets one when models show up", () => {
    const { world } = joined(createWorld({ seed: 2, bonecos: 0 }), "sessao-1");
    expect(privateView(world, "sessao-1")?.boneco.assignedModel).toBeNull();
    const later = step(world, { elapsedMs: TICK_MS, models: ["modelo-b"] });
    expect(privateView(later.world, "sessao-1")?.boneco.assignedModel).toBe(
      "modelo-b"
    );
  });

  test("an unknown session has no private view", () => {
    expect(
      privateView(createWorld({ seed: 1, bonecos: 0 }), "ninguem")
    ).toBeNull();
  });
});
