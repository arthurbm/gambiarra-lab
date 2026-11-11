import { describe, expect, test } from "bun:test";
import type { AdminState } from "@gambiarra-lab/frevo/views";
import { adminNow } from "./admin-now";

const base: AdminState = {
  bonecos: [],
  clock: {
    phase: "entrada",
    paused: false,
    durationMs: null,
    remainingMs: null,
    durations: { formar: 150_000, compor: 150_000, desfile: 180_000 },
  },
  jury: {
    desfile: null,
    generations: null,
    playing: null,
    sound: { enabled: true, playing: null },
    tracks: {},
  },
  people: { connected: 0, joined: 0, simulated: 0 },
  spending: { ceilingUsd: 1, exceeded: false, spentUsd: 0 },
};

function boneco(id: string): AdminState["bonecos"][number] {
  return {
    id,
    name: id,
    look: 0,
    instrument: null,
    model: null,
    silenced: false,
    simulated: false,
    connected: true,
  };
}

function inPhase(phase: AdminState["clock"]["phase"]): AdminState {
  return {
    ...base,
    clock: { ...base.clock, phase, durationMs: 150_000, remainingMs: 95_000 },
  };
}

describe("the admin's now card", () => {
  test("the entrance counts who is in and tells the host when to start", () => {
    expect(adminNow(base).title).toContain("ninguém na praça");
    const some = adminNow({ ...base, bonecos: [boneco("a"), boneco("b")] });
    expect(some.title).toBe("Entrada aberta: 2 bonecos na praça");
    expect(some.text).toContain("inicie");
    expect(some.warnings).toEqual([]);
  });

  test("a timed phase says when it turns by itself", () => {
    expect(adminNow(inPhase("formar")).text).toContain("vira sozinha em 1:35");
    expect(adminNow(inPhase("compor")).text).toContain("vira sozinha em 1:35");
  });

  test("the desfile hands the turn to the host, and the final points at the restart", () => {
    expect(adminNow(inPhase("desfile")).text).toContain("marque até três");
    expect(
      adminNow({ ...base, clock: { ...base.clock, phase: "final" } }).text
    ).toContain("reinicie");
  });

  test("warnings come first for what stops the show: pause, spending, sound", () => {
    const { warnings } = adminNow({
      ...base,
      clock: { ...base.clock, paused: true },
      spending: { ceilingUsd: 1, exceeded: true, spentUsd: 1.2 },
      jury: { ...base.jury, sound: { enabled: false, playing: null } },
    });
    expect(warnings).toHaveLength(3);
    expect(warnings[0]).toContain("Pausado");
    expect(warnings[1]).toContain("Teto de gasto");
    expect(warnings[2]).toContain("Som do telão desligado");
  });
});
