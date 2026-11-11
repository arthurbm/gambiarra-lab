import { describe, expect, test } from "bun:test";
import {
  acceptPersonName,
  createWorld,
  join,
  PERSON_NAME_MAX_LENGTH,
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
    expect(boneco?.id).toBe(bonecoId as string);
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

  test("the square takes up to 30 bonecos; whoever is in still comes back", () => {
    let world = createWorld({ seed: 1, bonecos: 0 });
    for (let index = 1; index <= 30; index += 1) {
      ({ world } = joined(world, `sessao-${index}`));
    }
    const full = joined(world, "sessao-31");
    expect(full.full).toBe(true);
    expect(full.bonecoId).toBeNull();
    expect(publicSnapshot(full.world).bonecos).toHaveLength(30);
    const back = joined(full.world, "sessao-7");
    expect(back.full).toBe(false);
    expect(back.created).toBe(false);
    expect(back.bonecoId).toBe(
      privateView(world, "sessao-7")?.boneco.id as string
    );
  });

  test("the ceiling comes from the rules and counts the bonecos already walking", () => {
    const world = createWorld({
      seed: 1,
      bonecos: 2,
      rules: { maxBonecos: 3 },
    });
    const third = joined(world, "sessao-1");
    expect(third.created).toBe(true);
    expect(joined(third.world, "sessao-2").full).toBe(true);
  });

  test("a person who gives a name gets a boneco called that", () => {
    const start = createWorld({ seed: 1, bonecos: 0 });
    const { world } = join(start, { sessionId: "sessao-1", name: "Arthur" });
    expect(publicSnapshot(world).bonecos[0]?.name).toBe("Arthur");
    // The name is the session's: coming back with another keeps the first.
    const again = join(world, { sessionId: "sessao-1", name: "Outro" });
    expect(again.created).toBe(false);
    expect(publicSnapshot(again.world).bonecos[0]?.name).toBe("Arthur");
  });

  test("two people with the same name are told apart by a number", () => {
    let world = createWorld({ seed: 1, bonecos: 0 });
    for (const [index, name] of ["Ana", "ana", "Ana"].entries()) {
      ({ world } = join(world, { sessionId: `sessao-${index + 1}`, name }));
    }
    expect(publicSnapshot(world).bonecos.map((boneco) => boneco.name)).toEqual([
      "Ana",
      "ana 2",
      "Ana 3",
    ]);
  });

  test("a typed name goes through the telão's filter", () => {
    expect(acceptPersonName("  Maria   Clara ")).toBe("Maria Clara");
    expect(acceptPersonName("Zé do Frevo")).toBe("Zé do Frevo");
    expect(acceptPersonName("")).toBeNull();
    expect(acceptPersonName("   ")).toBeNull();
    expect(acceptPersonName(42)).toBeNull();
    // Refused, not cut: the person picks a shorter one.
    expect(acceptPersonName("x".repeat(PERSON_NAME_MAX_LENGTH))).not.toBeNull();
    expect(acceptPersonName("x".repeat(PERSON_NAME_MAX_LENGTH + 1))).toBeNull();
    expect(acceptPersonName("Zé Porra")).toBeNull();
    expect(acceptPersonName("名前")).toBeNull();
  });

  test("an unknown session has no private view", () => {
    expect(
      privateView(createWorld({ seed: 1, bonecos: 0 }), "ninguem")
    ).toBeNull();
  });
});
