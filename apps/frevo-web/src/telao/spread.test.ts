import { describe, expect, test } from "bun:test";
import { spreadOut } from "./spread";

function apart(
  offsets: Map<string, { x: number; y: number }>,
  points: Array<{ id: string; x: number; y: number }>
) {
  return points.map((point) => {
    const offset = offsets.get(point.id) ?? { x: 0, y: 0 };
    return { x: point.x + offset.x, y: point.y + offset.y };
  });
}

describe("spreading a crowd so every boneco shows", () => {
  test("a lone boneco stays where it is", () => {
    const offsets = spreadOut([{ id: "a", x: 10, y: 10 }], 12);
    expect(offsets.get("a") ?? { x: 0, y: 0 }).toEqual({ x: 0, y: 0 });
  });

  test("bonecos on the very same spot fan out around it", () => {
    const points = ["a", "b", "c", "d"].map((id) => ({ id, x: 50, y: 50 }));
    const drawn = apart(spreadOut(points, 12), points);
    for (const [index, one] of drawn.entries()) {
      for (const other of drawn.slice(index + 1)) {
        expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThan(8);
      }
      // Still around the spot.
      expect(Math.hypot(one.x - 50, one.y - 50)).toBeLessThan(20);
    }
  });

  test("always fans out the same way", () => {
    const points = ["a", "b"].map((id) => ({ id, x: 0, y: 0 }));
    expect(spreadOut(points, 12)).toEqual(spreadOut(points, 12));
  });
});
