import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { type RunningFrevo, startFrevo } from "./frevo";
import { cutSpeeches, formatReport, runLoad } from "./frevo-load";

const SECRET = randomBytes(12).toString("hex");
let frevo: RunningFrevo;

describe("frevo load", () => {
  beforeAll(async () => {
    frevo = await startFrevo({
      host: "127.0.0.1",
      ports: { hub: 0, world: 0, web: 0 },
      real: false,
      web: false,
      roomName: `carga-${randomBytes(3).toString("hex")}`,
      env: {
        FREVO_ADMIN_SECRET: SECRET,
        FREVO_BONECOS: "0",
        FREVO_FAKE_LATENCY_MS: "40",
        FREVO_FAKE_FAILURES: "0",
      },
      onLine: () => undefined,
    });
  }, 60_000);

  afterAll(async () => {
    await frevo.stop();
  }, 30_000);

  test("phones over the network play a whole dynamic to the final", async () => {
    const report = await runLoad({
      url: frevo.worldUrl,
      secret: SECRET,
      phones: 9,
      answerDelayMs: [100, 400],
      durations: { formar: 12_000, compor: 30_000, desfile: 4000 },
      timeoutMs: 90_000,
    });

    expect(report.errors).toEqual([]);
    expect(report.finished).toBe(true);
    expect(report.phases.map((phase) => phase.phase)).toEqual([
      "entrada",
      "formar",
      "compor",
      "desfile",
      "final",
    ]);
    expect(report.latency.entrar.count).toBe(9);
    expect(report.latency.entrarAteTelao.count).toBe(9);
    expect(report.latency.inicioAteCelular.count).toBe(9);
    expect(report.latency.voto.count).toBeGreaterThan(0);
    expect(report.bloco.phonesWithTwoMates).toBe(9);
    expect(report.blocos.every((bloco) => bloco.name && bloco.refrain)).toBe(
      true
    );
    expect(formatReport(report)).toContain("| entrar (POST /api/entrar) | 9 |");
  }, 150_000);

  test("refuses a wrong secret without playing", async () => {
    const report = await runLoad({
      url: frevo.worldUrl,
      secret: "errado",
      phones: 1,
      timeoutMs: 5000,
    });
    expect(report.finished).toBe(false);
    expect(report.errors.join(" ")).toContain("401");
    expect(report.phones).toBe(0);
  }, 30_000);

  test("flags lines cut at the limit in the middle of a sentence", () => {
    const cut = "a".repeat(139);
    const whole = `${"b".repeat(138)}.`;
    expect(
      cutSpeeches({ speeches: [cut, whole, "curta"] } as Parameters<
        typeof cutSpeeches
      >[0])
    ).toEqual([cut]);
  });
});
