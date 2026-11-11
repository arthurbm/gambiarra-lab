import { describe, expect, test } from "bun:test";
import { type Balloon, layoutBalloons, type Speaker } from "./balloons";

const AREA = { width: 1280, height: 720 };
const STYLE = { fontSize: 20, maxWidth: 360, max: 3 };

function speaker(id: string, x: number, y: number, seenAt = 0): Speaker {
  return {
    id,
    name: id,
    text: "Bora pro Marco Zero!",
    headX: x,
    headY: y,
    footY: y + 60,
    seenAt,
  };
}

function overlap(a: Balloon, b: Balloon) {
  return (
    a.left < b.left + b.width &&
    b.left < a.left + a.width &&
    a.top < b.top + b.height &&
    b.top < a.top + a.height
  );
}

describe("balloons on the telão", () => {
  test("a lone speaker gets a balloon above the head", () => {
    const { balloons, hidden } = layoutBalloons(
      [speaker("Lia", 600, 300)],
      AREA,
      STYLE
    );
    expect(hidden).toEqual([]);
    expect(balloons).toHaveLength(1);
    const [balloon] = balloons as [Balloon];
    expect(balloon.text).toBe("Bora pro Marco Zero!");
    expect(balloon.top + balloon.height).toBeLessThanOrEqual(300);
    expect(balloon.left).toBeLessThan(600);
    expect(balloon.left + balloon.width).toBeGreaterThan(600);
  });

  test("only the newest speech gets text; the rest show hidden", () => {
    const speakers = [
      speaker("a", 100, 200, 1),
      speaker("b", 500, 200, 5),
      speaker("c", 900, 200, 3),
      speaker("d", 300, 600, 4),
      speaker("e", 1100, 600, 2),
    ];
    const { balloons, hidden } = layoutBalloons(speakers, AREA, STYLE);
    expect(balloons.map((balloon) => balloon.id).sort()).toEqual([
      "b",
      "c",
      "d",
    ]);
    expect(hidden.sort()).toEqual(["a", "e"]);
  });

  test("neighbours' balloons do not cover each other", () => {
    const { balloons } = layoutBalloons(
      [speaker("a", 600, 300, 2), speaker("b", 640, 310, 1)],
      AREA,
      STYLE
    );
    expect(balloons).toHaveLength(2);
    expect(overlap(balloons[0] as Balloon, balloons[1] as Balloon)).toBe(false);
  });

  test("a crowd that leaves no room falls back to hidden", () => {
    const crowd = [0, 1, 2, 3, 4].map((index) =>
      speaker(`s${index}`, 600 + index * 4, 300, index)
    );
    const { balloons, hidden } = layoutBalloons(crowd, AREA, {
      ...STYLE,
      max: 5,
    });
    for (const a of balloons) {
      for (const b of balloons) {
        if (a !== b) {
          expect(overlap(a, b)).toBe(false);
        }
      }
    }
    expect(balloons.length + hidden.length).toBe(5);
    expect(hidden.length).toBeGreaterThan(0);
  });

  test("stays inside the square near its edges", () => {
    const { balloons } = layoutBalloons([speaker("left", 4, 20)], AREA, STYLE);
    const [balloon] = balloons as [Balloon];
    expect(balloon.left).toBeGreaterThanOrEqual(0);
    expect(balloon.top).toBeGreaterThanOrEqual(0);
  });

  test("long speech is cut to two lines with an ellipsis", () => {
    const long = {
      ...speaker("Capiba", 600, 300),
      text: "Vamos todo mundo para a ponte agora que o frevo vai começar e ninguém pode ficar parado aqui na praça",
    };
    const [balloon] = layoutBalloons([long], AREA, STYLE).balloons as [Balloon];
    expect(balloon.text.endsWith("…")).toBe(true);
    expect(balloon.text.length).toBeLessThan(long.text.length);
    expect(balloon.width).toBeLessThanOrEqual(STYLE.maxWidth);
  });
});
