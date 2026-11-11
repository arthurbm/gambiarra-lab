import { describe, expect, test } from "bun:test";
import { colorAt, type Drawing } from "./pixels";
import {
  bandeirinhas,
  CASARIOS,
  confetti,
  ESCULTURAS,
  GALO,
  GIGANTES,
  JANGADA,
  LETREIRO,
  PONTE,
  POSTE,
  REEF,
  ROSA_DOS_VENTOS,
  SEA,
  SHORE,
  STREET,
  TORRE,
} from "./recife";

const HEX = /^#[0-9a-f]{6}$/;
const TILES: Drawing[] = [...SEA.flat(), ...REEF, ...SHORE, STREET];
const DRAWINGS: Drawing[] = [
  ...TILES,
  ...Object.values(CASARIOS),
  ...Object.values(ESCULTURAS),
  ...Object.values(GIGANTES),
  GALO,
  JANGADA,
  LETREIRO,
  PONTE,
  POSTE,
  ROSA_DOS_VENTOS,
  TORRE,
  bandeirinhas(40, 5),
];

describe("Recife, drawn by code", () => {
  test("every drawing fills its grid with colours or nothing", () => {
    for (const drawing of DRAWINGS) {
      expect(drawing.cells).toHaveLength(drawing.w * drawing.h);
      const painted = drawing.cells.filter((color) => color !== null);
      expect(painted.length).toBeGreaterThan(0);
      expect(painted.filter((color) => !HEX.test(color))).toEqual([]);
    }
  });

  test("ground tiles are whole tiles with no hole in them", () => {
    for (const tile of TILES) {
      expect({ w: tile.w, h: tile.h }).toEqual({ w: 16, h: 16 });
      expect(tile.cells).not.toContain(null);
    }
  });

  test("the Torre de Cristal is the tallest thing on the reef", () => {
    for (const other of [GALO, LETREIRO, ...Object.values(ESCULTURAS)]) {
      expect(TORRE.h).toBeGreaterThan(other.h);
    }
  });

  test("the compass rose is round, with its marker in the middle", () => {
    const last = ROSA_DOS_VENTOS.w - 1;
    expect(ROSA_DOS_VENTOS.h).toBe(ROSA_DOS_VENTOS.w);
    expect(colorAt(ROSA_DOS_VENTOS, 0, 0)).toBeNull();
    expect(colorAt(ROSA_DOS_VENTOS, last, last)).toBeNull();
    expect(colorAt(ROSA_DOS_VENTOS, last / 2, last / 2)).not.toBeNull();
    // North and south point in different colours.
    expect(colorAt(ROSA_DOS_VENTOS, last / 2 - 1, 12)).not.toBe(
      colorAt(ROSA_DOS_VENTOS, last / 2 - 1, last - 12)
    );
  });

  test("bandeirinhas hang lowest in the middle of the string", () => {
    const string = bandeirinhas(41, 6);
    const rowOfString = (x: number) =>
      Array.from({ length: string.h }, (_, y) => y).find(
        (y) => colorAt(string, x, y) !== null
      );
    expect(rowOfString(0)).toBe(0);
    expect(rowOfString(40)).toBe(0);
    expect(rowOfString(20)).toBe(6);
  });

  test("confetti falls inside its area, the same pieces every time", () => {
    const area = { x: 10, y: 20, w: 30, h: 40 };
    const pieces = confetti(area, 50);
    expect(pieces).toHaveLength(50);
    expect(pieces).toEqual(confetti(area, 50));
    for (const piece of pieces) {
      expect(piece.x).toBeGreaterThanOrEqual(10);
      expect(piece.x).toBeLessThan(40);
      expect(piece.y).toBeGreaterThanOrEqual(20);
      expect(piece.y).toBeLessThan(60);
    }
  });
});
