import { describe, expect, test } from "bun:test";
import { MEETING_SPOTS } from "./meeting-spots";
import { PRACA } from "./world";

const distance = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("the meeting spots of the square", () => {
  test("there are 8 to 10, each with its own id", () => {
    expect(MEETING_SPOTS.length).toBeGreaterThanOrEqual(8);
    expect(MEETING_SPOTS.length).toBeLessThanOrEqual(10);
    expect(new Set(MEETING_SPOTS.map((spot) => spot.id)).size).toBe(
      MEETING_SPOTS.length
    );
  });

  test("leave room for a group of three inside the square", () => {
    for (const spot of MEETING_SPOTS) {
      expect(spot.x).toBeGreaterThanOrEqual(10);
      expect(spot.x).toBeLessThanOrEqual(PRACA.width - 10);
      expect(spot.y).toBeGreaterThanOrEqual(14);
      expect(spot.y).toBeLessThanOrEqual(PRACA.height - 8);
    }
  });

  test("do not sit on a place or on each other", () => {
    for (const spot of MEETING_SPOTS) {
      for (const place of PRACA.places) {
        expect(distance(spot, place)).toBeGreaterThanOrEqual(16);
      }
      for (const other of MEETING_SPOTS) {
        if (other !== spot) {
          expect(distance(spot, other)).toBeGreaterThanOrEqual(20);
        }
      }
    }
  });
});
