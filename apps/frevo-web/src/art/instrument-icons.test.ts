import { describe, expect, test } from "bun:test";
import { INSTRUMENTS } from "./characters";
import { INSTRUMENT_ICONS, iconPixels } from "./instrument-icons";

describe("the frevo instrument icons", () => {
  test("every instrument is a 16 x 16 drawing in the icon palette", () => {
    for (const instrument of INSTRUMENTS) {
      const rows = INSTRUMENT_ICONS[instrument];
      expect(rows).toHaveLength(16);
      for (const row of rows) {
        expect(row).toHaveLength(16);
      }
      expect(iconPixels(instrument).length).toBeGreaterThan(20);
    }
  });

  test("lists the painted pixels with their colours", () => {
    const pixels = iconPixels("sombrinha");
    expect(pixels).toContainEqual({ x: 7, y: 0, color: "#141b1b" });
    expect(pixels.every((pixel) => pixel.color.startsWith("#"))).toBe(true);
  });
});
