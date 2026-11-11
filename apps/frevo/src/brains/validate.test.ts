import { describe, expect, test } from "bun:test";
import { toolArguments } from "./validate";

const TOOL = {
  type: "function" as const,
  function: {
    name: "agir",
    description: "Decide.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["acao", "fala"],
      properties: {
        acao: { type: "string", enum: ["andar", "falar"] },
        lugar: { type: "string", enum: ["fonte", "coreto"] },
        fala: { type: "string", maxLength: 80 },
        opcoes: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          items: { type: "string" },
        },
      },
    },
  },
};

function answer(args: string, name = "agir") {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { type: "function", function: { name, arguments: args } },
          ],
        },
      },
    ],
  };
}

describe("the arguments of a tool call", () => {
  test("come back when they satisfy the tool's schema", () => {
    const result = toolArguments(
      answer('{"acao":"andar","lugar":"fonte","fala":"Bora, visse!"}'),
      TOOL
    );
    expect(result).toEqual({
      ok: true,
      args: { acao: "andar", lugar: "fonte", fala: "Bora, visse!" },
    });
  });

  test("are refused when the answer has no tool call", () => {
    const result = toolArguments(
      {
        choices: [{ message: { role: "assistant", content: "Vou à fonte." } }],
      },
      TOOL
    );
    expect(result).toMatchObject({ ok: false });
  });

  test("are refused when cut short even though the JSON parses", () => {
    for (const cut of ['{"acao":"fal"}', '{"acao":"falar"}', "{}"]) {
      expect(toolArguments(answer(cut), TOOL)).toMatchObject({ ok: false });
    }
  });

  test("are refused for another tool, broken JSON, unknown fields or wrong types", () => {
    const valid = '{"acao":"andar","fala":"Oi"}';
    expect(toolArguments(answer(valid, "outra"), TOOL).ok).toBe(false);
    expect(toolArguments(answer('{"acao":"andar",'), TOOL).ok).toBe(false);
    expect(
      toolArguments(answer('{"acao":"andar","fala":"Oi","extra":1}'), TOOL).ok
    ).toBe(false);
    expect(
      toolArguments(answer('{"acao":"andar","fala":"Oi","opcoes":["a"]}'), TOOL)
        .ok
    ).toBe(false);
    expect(toolArguments(answer('{"acao":"andar","fala":3}'), TOOL).ok).toBe(
      false
    );
    expect(
      toolArguments(answer(`{"acao":"andar","fala":"${"a".repeat(81)}"}`), TOOL)
        .ok
    ).toBe(false);
  });

  test("are refused when a line has letters outside the Latin alphabet", () => {
    for (const leak of [
      "Ô meu人力资源 do Frevo, bora?",
      "Responde proカバー aí",
      "Vou pro coreto,、若",
    ]) {
      expect(
        toolArguments(
          answer(JSON.stringify({ acao: "falar", fala: leak })),
          TOOL
        )
      ).toMatchObject({ ok: false });
    }
    expect(
      toolArguments(
        answer(
          JSON.stringify({ acao: "falar", fala: "Ô, coração! Ação já? 🎺" })
        ),
        TOOL
      ).ok
    ).toBe(true);
  });
});
