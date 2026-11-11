import { describe, expect, test } from "bun:test";
import { clockText, nextPhase, PHASE_LABELS, phaseLine } from "./phase-text";

describe("the phase as people read it", () => {
  test("every phase has a name in plain Portuguese", () => {
    expect(PHASE_LABELS).toEqual({
      entrada: "Entrada",
      formar: "Conhecer e formar",
      compor: "Compor",
      desfile: "Desfile e júri",
      final: "Final",
    });
  });

  test("the time left reads as minutes and seconds, rounding up", () => {
    expect(clockText(150_000)).toBe("2:30");
    expect(clockText(59_001)).toBe("1:00");
    expect(clockText(9000)).toBe("0:09");
    expect(clockText(0)).toBe("0:00");
  });

  test("one line says the phase, the time and the pause", () => {
    const base = {
      phase: "formar" as const,
      paused: false,
      durationMs: 150_000,
      remainingMs: 61_000,
      durations: { formar: 150_000, compor: 150_000, desfile: 180_000 },
    };
    expect(phaseLine(base)).toBe("Conhecer e formar · 1:01");
    expect(phaseLine({ ...base, paused: true })).toBe(
      "Conhecer e formar · 1:01 · pausado"
    );
    expect(
      phaseLine({
        ...base,
        phase: "entrada",
        durationMs: null,
        remainingMs: null,
      })
    ).toBe("Entrada");
  });

  test("the phase after each one, and none after the final", () => {
    expect(nextPhase("entrada")).toBe("formar");
    expect(nextPhase("desfile")).toBe("final");
    expect(nextPhase("final")).toBeNull();
  });
});
