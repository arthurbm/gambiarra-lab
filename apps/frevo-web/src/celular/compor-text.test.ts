import { describe, expect, test } from "bun:test";
import type { ComposeView } from "@gambiarra-lab/frevo/snapshot";
import { optionCredit, roundLine, voteCount } from "./compor-text";

const voting: ComposeView = {
  name: null,
  refrain: null,
  round: "nome",
  voting: true,
  options: [
    { by: "Biu", human: false, lines: ["Bloco da Maré"] },
    { by: "Lia", human: false, lines: ["Bloco do Sol"] },
  ],
  proposals: 2,
  votes: 1,
  voters: 3,
  yourVote: 0,
};

describe("the compor panel's words", () => {
  test("say how many voted, out of the bloco's humans", () => {
    expect(voteCount(voting)).toBe("1 de 3 pessoas do bloco já votaram.");
    expect(roundLine(voting)).toBe("1 de 3 pessoas do bloco já votaram.");
  });

  test("say the bonecos are proposing before the vote", () => {
    expect(roundLine({ ...voting, voting: false, proposals: 0 })).toBe(
      "Os bonecos estão pensando em nomes…"
    );
    expect(
      roundLine({ ...voting, round: "refrao", voting: false, proposals: 2 })
    ).toBe("Os bonecos estão propondo refrões: 2 até agora.");
  });

  test("say who each option came from: a boneco, a person or the reserve", () => {
    const [first] = voting.options;
    expect(optionCredit(first as (typeof voting.options)[0], "nome")).toBe(
      "proposta de Biu"
    );
    expect(
      optionCredit({ by: "Ana", human: true, lines: ["Bloco da Ana"] }, "nome")
    ).toBe("Ana escreveu no celular");
    const nobody = { by: null, human: false, lines: ["Bloco do Passo"] };
    expect(optionCredit(nobody, "nome")).toBe("nome de reserva");
    expect(optionCredit(nobody, "ajuste")).toBe("o refrão de agora");
  });
});
