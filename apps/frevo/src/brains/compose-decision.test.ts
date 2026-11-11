import { describe, expect, test } from "bun:test";
import type { NameRequest, RefrainRequest } from "../sim/world";
import { REFRAIN_MAX_TOKENS } from "./decision";
import { decisionBody, readDecision } from "./scheduler";

const people = [
  {
    name: "Biu",
    personality: ["Ama tapioca.", "Dança na chuva."],
    instrument: "tuba",
  },
  {
    name: "Lia",
    personality: ["Vive na praia.", "Canta alto."],
    instrument: null,
  },
];

const nameRequest: NameRequest = {
  kind: "nome",
  id: "boneco-1#5",
  boneco: { id: "boneco-1", name: "Biu" },
  deadlineMs: 1000,
  people,
  taken: ["Bloco do Sol"],
};

const refrainRequest: RefrainRequest = {
  kind: "refrao",
  id: "boneco-1#6",
  boneco: { id: "boneco-1", name: "Biu" },
  deadlineMs: 1000,
  people,
  blocoName: "Bloco da Maré",
  current: null,
};

function completion(args: unknown) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            { function: { name: "agir", arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
  };
}

describe("composing decisions", () => {
  test("the refrain gets its own max_tokens; the name keeps the default", () => {
    expect(decisionBody(refrainRequest, "p1", 400).max_tokens).toBe(
      REFRAIN_MAX_TOKENS
    );
    expect(decisionBody(nameRequest, "p1", 400).max_tokens).toBe(400);
  });

  test("the prompt carries every personality of the bloco and the names to avoid", () => {
    const text = JSON.stringify(decisionBody(nameRequest, "p1").messages);
    expect(text).toContain("Ama tapioca.");
    expect(text).toContain("Vive na praia.");
    expect(text).toContain("Bloco do Sol");
  });

  test("a name and a refrain come back as actions", () => {
    const nameBody = decisionBody(nameRequest, "p1");
    expect(
      readDecision(
        completion({ nome: "Bloco da Tapioca" }),
        nameBody,
        nameRequest
      )
    ).toEqual({ ok: true, action: { type: "nome", name: "Bloco da Tapioca" } });
    const refrainBody = decisionBody(refrainRequest, "p1");
    expect(
      readDecision(
        completion({ em_comum: "praia", versos: ["Ô maré", "Leva o bloco"] }),
        refrainBody,
        refrainRequest
      )
    ).toEqual({
      ok: true,
      action: {
        type: "refrao",
        common: "praia",
        lines: ["Ô maré", "Leva o bloco"],
      },
    });
  });

  test("a refrain with one verse or five is refused", () => {
    const body = decisionBody(refrainRequest, "p1");
    for (const versos of [["Só um"], ["1", "2", "3", "4", "5"]]) {
      expect(
        readDecision(
          completion({ em_comum: "x", versos }),
          body,
          refrainRequest
        ).ok
      ).toBe(false);
    }
  });
});
