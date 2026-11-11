import { describe, expect, test } from "bun:test";
import type { DecisionRequest } from "../sim/world";
import { PRACA } from "../sim/world";
import { decisionMessages } from "./decision";

const base = { boneco: { id: "boneco-1", name: "Biu" }, deadlineMs: 1000 };
const people = [
  { name: "Biu", instrument: "tuba", personality: ["Gosta de praia."] },
  { name: "Lia", instrument: null, personality: null },
];

const REQUESTS: DecisionRequest[] = [
  { ...base, id: "w", placeId: null, places: PRACA.places },
  { ...base, id: "q", kind: "question", index: 1, total: 3, previous: [] },
  {
    ...base,
    id: "p",
    kind: "personality",
    answers: [],
    freeText: null,
    instruments: ["tuba"],
  },
  {
    ...base,
    id: "e",
    kind: "encounter",
    instrument: null,
    personality: null,
    other: people[1] as (typeof people)[1],
  },
  { ...base, id: "m", kind: "maestro", people, sizes: [2] },
  { ...base, id: "n", kind: "nome", people, taken: [] },
  {
    ...base,
    id: "r",
    kind: "refrao",
    blocoName: "Bloco",
    current: null,
    people,
  },
];

function system(request: DecisionRequest): string {
  return decisionMessages(request)[0]?.content ?? "";
}

describe("the prompts on the telão", () => {
  test("every kind of decision forbids talking about people's colour, race or body, and nicknames", () => {
    for (const request of REQUESTS) {
      const prompt = system(request);
      expect(prompt).toContain("cor, raça, etnia, corpo, aparência");
      expect(prompt).toContain("Não use apelido nem gíria");
      expect(prompt).toContain("duplo sentido");
      expect(prompt).toContain("não comece com oxe, visse nem bora");
    }
  });

  test("a question is not numbered, so the number does not leak into it", () => {
    const [, user] = decisionMessages(REQUESTS[1] as DecisionRequest);
    expect(user?.content).not.toContain("pergunta 2 de 3");
    expect(user?.content).toContain("sem número");
  });
});

describe("where to walk", () => {
  test("the model sees how many bonecos without a bloco are at each place and is asked to spread out", () => {
    const [, user] = decisionMessages({
      ...base,
      id: "w2",
      placeId: null,
      places: PRACA.places,
      crowd: { "marco-zero": 4, coreto: 1, ponte: 0 },
    });
    expect(user?.content).toContain("Marco Zero (4 bonecos sem bloco)");
    expect(user?.content).toContain("Coreto (1 boneco sem bloco)");
    expect(user?.content).toContain("Ponte (ninguém sem bloco)");
    expect(user?.content).toContain(
      "Prefira um lugar com menos gente sem bloco"
    );
  });
});
