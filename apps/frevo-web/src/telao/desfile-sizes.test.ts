import { describe, expect, test } from "bun:test";
import { nameSizeVw, refrainSizeVw } from "./desfile-sizes";

describe("the desfile card's letters", () => {
  test("stay at their largest for a short name and refrain", () => {
    expect(nameSizeVw("Bloco Doce Ladeira")).toBe(4.6);
    expect(refrainSizeVw(["Na ladeira, o frevo faz girar", "Bora!"])).toBe(3.3);
  });

  test("shrink so a 40-letter name and 60-letter lines keep one line each", () => {
    const line = "x".repeat(60);
    expect(nameSizeVw("x".repeat(40))).toBeLessThanOrEqual(2.6);
    expect(refrainSizeVw([line, line, line, line])).toBeLessThanOrEqual(1.75);
    expect(refrainSizeVw([line, line, line, line])).toBeGreaterThan(1.4);
  });

  test("never get smaller than the floor, whatever the text", () => {
    expect(refrainSizeVw(["x".repeat(200)])).toBe(1.4);
    expect(nameSizeVw("x".repeat(200))).toBe(1.8);
  });
});
