import { describe, expect, test } from "bun:test";
import {
  CHARACTERS,
  characterSheetUrl,
  faceUrl,
  instrumentOf,
  lookOf,
} from "./characters";

describe("how a boneco looks", () => {
  test("the pack gives 30 generic characters: villagers, ninjas, animals", () => {
    expect(CHARACTERS).toHaveLength(30);
    const kinds = new Set(CHARACTERS.map((id) => id.split("-")[0]));
    expect([...kinds].sort()).toEqual(["animal", "ninja", "villager"]);
  });

  test("uses the look the world chose", () => {
    expect(lookOf({ id: "boneco-1", look: 7 })).toBe(7);
    expect(characterSheetUrl(7)).toBe("/art/characters/villager-08.png");
    expect(faceUrl(29)).toBe("/art/faces/animal-08.png");
  });

  test("without a look, picks one from the id that never changes", () => {
    const look = lookOf({ id: "boneco-12" });
    expect(look).toBeGreaterThanOrEqual(0);
    expect(look).toBeLessThan(30);
    expect(lookOf({ id: "boneco-12", look: null })).toBe(look);
  });

  test("thirty ids spread over many looks", () => {
    const looks = new Set(
      Array.from({ length: 30 }, (_, index) =>
        lookOf({ id: `boneco-${index + 1}` })
      )
    );
    expect(looks.size).toBeGreaterThanOrEqual(15);
  });

  test("a look out of range still lands on a character", () => {
    expect(lookOf({ id: "x", look: 31 })).toBe(1);
    expect(lookOf({ id: "x", look: -1 })).toBe(29);
  });

  test("only the eight frevo instruments become a costume", () => {
    expect(instrumentOf("sombrinha")).toBe("sombrinha");
    expect(instrumentOf("guitarra")).toBeNull();
    expect(instrumentOf(undefined)).toBeNull();
    expect(instrumentOf(null)).toBeNull();
  });
});
