import { describe, expect, test } from "bun:test";
import { trackText } from "./track-text";

const BASE = { url: null, reason: null, generator: null, runningMs: null };

describe("the music's progress on the admin", () => {
  test("says which generator runs and for how long", () => {
    expect(
      trackText({
        ...BASE,
        state: "gerando",
        generator: "MiniMax",
        runningMs: 41_600,
      })
    ).toBe("música sendo feita no MiniMax há 41 s");
  });

  test("before a generator starts, says only that it is being made", () => {
    expect(trackText({ ...BASE, state: "gerando", runningMs: 300 })).toBe(
      "música sendo feita há 0 s"
    );
  });

  test("ready or the reserve track, as before", () => {
    expect(
      trackText({ ...BASE, state: "pronta", url: "/api/musica/a.mp3" })
    ).toBe("música pronta");
    expect(trackText({ ...BASE, state: "reserva", url: "/audio/r.mp3" })).toBe(
      "música de reserva"
    );
  });
});
