import { describe, expect, test } from "bun:test";
import type { PhoneView } from "@gambiarra-lab/frevo/views";
import { nowCard } from "./now-text";

const clock: PhoneView["clock"] = {
  phase: "entrada",
  paused: false,
  durationMs: null,
  remainingMs: null,
  durations: { formar: 150_000, compor: 150_000, desfile: 180_000 },
};

const base: PhoneView = {
  ask: null,
  bloco: null,
  boneco: {
    id: "boneco-1",
    name: "Ana",
    look: 0,
    instrument: null,
    x: 0,
    y: 0,
    facing: "down",
    walking: false,
    thinking: false,
    thinkingForMs: null,
    asking: false,
    bloco: null,
    speech: null,
    brain: null,
    assignedModel: null,
    model: null,
    personality: null,
  },
  clock,
  compor: null,
  desfile: null,
  interview: { answered: 3, total: 3, done: true },
  phase: "entrada",
  talks: [],
  thoughts: [],
  timeMs: 0,
};

function ask(
  purpose: string,
  textMaxLength: number | null = null
): PhoneView["ask"] {
  return {
    id: "boneco-1?1",
    purpose,
    question: "?",
    options: ["A", "B"],
    remainingMs: 10_000,
    totalMs: 30_000,
    textMaxLength,
  };
}

const compor: NonNullable<PhoneView["compor"]> = {
  name: null,
  refrain: null,
  round: "nome",
  voting: true,
  options: [],
  proposals: 2,
  votes: 1,
  voters: 3,
  yourVote: null,
};

describe("the phone's now card", () => {
  test("an open question is the person's turn, whatever the phase", () => {
    const interview = nowCard({
      ...base,
      ask: ask("interview"),
      interview: { answered: 1, total: 3, done: false },
    });
    expect(interview.look).toBe("celular");
    expect(interview.text).toContain("Pergunta 2 de 3");
    expect(
      nowCard({
        ...base,
        ask: { ...(ask("interview", 80) as object), options: [] } as never,
        interview: { answered: 3, total: 3, done: false },
      }).text
    ).toContain("Última pergunta");
    expect(nowCard({ ...base, phase: "formar", ask: ask("bloco") }).title).toBe(
      "Convite para um bloco"
    );
  });

  test("the name vote says a name may be written; the refrain vote does not", () => {
    const name = nowCard({
      ...base,
      phase: "compor",
      compor,
      ask: ask("voto", 40),
    });
    expect(name.title).toBe("Vote no nome do bloco");
    expect(name.text).toContain("escreva outro");
    const refrain = nowCard({
      ...base,
      phase: "compor",
      compor: { ...compor, round: "refrao" },
      ask: ask("voto"),
    });
    expect(refrain.title).toBe("Vote no refrão do bloco");
    expect(refrain.text).not.toContain("escreva");
  });

  test("between questions of the interview the person waits", () => {
    const card = nowCard({
      ...base,
      interview: { answered: 1, total: 3, done: false },
    });
    expect(card.look).toBe("espera");
  });

  test("with the interview done, the entrance sends the person to the telão by name", () => {
    const card = nowCard(base);
    expect(card.look).toBe("telao");
    expect(card.text).toContain("Procure Ana");
  });

  test("the formar phase says whether the boneco has a bloco", () => {
    expect(nowCard({ ...base, phase: "formar" }).title).toContain(
      "procurando um bloco"
    );
    expect(
      nowCard({
        ...base,
        phase: "formar",
        bloco: { id: "bloco-1", mark: 1, mates: [] },
      }).title
    ).toBe("Você está no Bloco 2!");
  });

  test("the compor phase follows the round: proposing, voted, ready", () => {
    const at = (next: Partial<typeof compor>) =>
      nowCard({ ...base, phase: "compor", compor: { ...compor, ...next } });
    expect(at({ voting: false }).title).toContain("pensando no nome");
    expect(at({ yourVote: 0 }).title).toBe("Voto registrado!");
    expect(at({ yourVote: 0 }).text).toBe(
      "1 de 3 pessoas do bloco já votaram."
    );
    expect(at({ round: "pronto", voting: false }).title).toBe("Bloco pronto!");
    expect(nowCard({ ...base, phase: "compor" }).title).toContain("maestro");
  });

  test("the desfile and the final say how the bloco did", () => {
    const desfile = {
      phase: "desfile" as "desfile" | "final",
      name: "Bloco da Maré",
      refrain: ["Um", "Dois"],
      onStage: false,
      chosen: false,
    };
    const at = (next: Partial<typeof desfile>) =>
      nowCard({
        ...base,
        phase: next.phase ?? "desfile",
        desfile: { ...desfile, ...next } as PhoneView["desfile"],
      });
    expect(at({}).title).toBe("Hora do desfile");
    expect(at({ onStage: true }).title).toContain("no palco agora");
    expect(at({ chosen: true }).title).toContain("escolhido pelo júri");
    expect(at({ phase: "final" }).text).toContain("não foi escolhido");
    expect(nowCard({ ...base, phase: "final" }).text).toContain("sem bloco");
  });
});
