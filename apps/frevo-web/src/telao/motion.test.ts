import { describe, expect, test } from "bun:test";
import { type Drawn, follow } from "./motion";

const RULES = { speed: 10, teleportDistance: 30 };

function at(x: number, y: number, facing: Drawn["facing"] = "down") {
  return { x, y, facing };
}

describe("a boneco following its snapshots", () => {
  test("appears where the snapshot puts it, standing", () => {
    const drawn = follow(undefined, at(40, 20, "left"), 16, RULES);
    expect(drawn).toEqual({ x: 40, y: 20, facing: "left", walking: false });
  });

  test("walks toward the new position instead of jumping", () => {
    const start = follow(undefined, at(0, 0), 16, RULES);
    const drawn = follow(start, at(10, 0), 100, RULES);
    expect(drawn.x).toBeGreaterThan(0);
    expect(drawn.x).toBeLessThan(10);
    expect(drawn.walking).toBe(true);
    expect(drawn.facing).toBe("right");
  });

  test("never overshoots and stops walking on arrival", () => {
    let drawn = follow(undefined, at(0, 0), 16, RULES);
    for (let frame = 0; frame < 120; frame += 1) {
      drawn = follow(drawn, at(0, -5, "up"), 16, RULES);
      expect(drawn.y).toBeGreaterThanOrEqual(-5);
    }
    expect(drawn).toEqual({ x: 0, y: -5, facing: "up", walking: false });
  });

  test("faces the way it is walking in all four directions", () => {
    const origin = follow(undefined, at(10, 10), 16, RULES);
    expect(follow(origin, at(10, 0), 50, RULES).facing).toBe("up");
    expect(follow(origin, at(10, 20), 50, RULES).facing).toBe("down");
    expect(follow(origin, at(0, 10), 50, RULES).facing).toBe("left");
    expect(follow(origin, at(20, 10), 50, RULES).facing).toBe("right");
  });

  test("does not flicker between two facings on a diagonal", () => {
    const walkingRight = {
      x: 0,
      y: 0,
      facing: "right" as const,
      walking: true,
    };
    // Slightly more down than right: not enough to turn.
    expect(follow(walkingRight, at(10, 11), 16, RULES).facing).toBe("right");
    expect(follow(walkingRight, at(10, 14), 16, RULES).facing).toBe("down");
  });

  test("teleports when it is too far behind, as after a new phase", () => {
    const start = follow(undefined, at(0, 0), 16, RULES);
    const drawn = follow(start, at(100, 0, "down"), 16, RULES);
    expect(drawn).toEqual({ x: 100, y: 0, facing: "down", walking: false });
  });

  test("hurries when it lags, so it never falls a snapshot behind", () => {
    const start = follow(undefined, at(0, 0), 16, RULES);
    const drawn = follow(start, at(20, 0), 100, RULES);
    // At the walking speed it would cover 1 unit; lagging 20, it covers more.
    expect(drawn.x).toBeGreaterThan(4);
  });

  test("a tab coming back from the background does not leap", () => {
    const start = follow(undefined, at(0, 0), 16, RULES);
    const drawn = follow(start, at(8, 0), 5000, RULES);
    expect(drawn.x).toBeLessThan(8);
  });
});
