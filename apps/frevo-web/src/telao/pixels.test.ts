import { describe, expect, test } from "bun:test";
import { blank, colorAt, ellipse, outline, paste, put, stamp } from "./pixels";

describe("a grid of art pixels", () => {
  test("stamps rows of letters in the palette's colours", () => {
    const grid = blank(3, 2);
    stamp(grid, ["A.B", ".?A"], 0, 0, { A: "#111111", B: "#222222" });
    expect(grid.cells).toEqual([
      "#111111",
      null,
      "#222222",
      null,
      null,
      "#111111",
    ]);
  });

  test("ignores what falls outside it", () => {
    const grid = blank(2, 2);
    put(grid, -1, 0, "#111111");
    put(grid, 2, 1, "#111111");
    ellipse(grid, 0, 0, 5, 5, "#222222");
    expect(grid.cells).toEqual(["#222222", "#222222", "#222222", "#222222"]);
    expect(colorAt(grid, 2, 0)).toBeNull();
  });

  test("outlines a shape on its empty neighbours, not on its corners", () => {
    const grid = blank(3, 3);
    put(grid, 1, 1, "#ffffff");
    outline(grid, "#000000");
    expect(grid.cells).toEqual([
      null,
      "#000000",
      null,
      "#000000",
      "#ffffff",
      "#000000",
      null,
      "#000000",
      null,
    ]);
  });

  test("pastes only the painted pixels of another drawing", () => {
    const grid = blank(2, 1, "#aaaaaa");
    const source = blank(2, 1);
    put(source, 1, 0, "#bbbbbb");
    paste(grid, source, 0, 0);
    expect(grid.cells).toEqual(["#aaaaaa", "#bbbbbb"]);
  });
});
