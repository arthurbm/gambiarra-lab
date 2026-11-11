import { describe, expect, test } from "bun:test";
import { modelLine } from "./model-line";

const BONECO = {
  assignedModel: "openai/gpt-6-luna",
  brain: "model" as const,
  model: "openai/gpt-6-luna",
  thinking: false,
};

describe("the line about the boneco's model", () => {
  test("names the model the boneco thinks with", () => {
    expect(modelLine(BONECO)).toBe("Quem pensa por você: GPT-6 Luna");
  });

  test("says which model answered when it was not the boneco's own", () => {
    expect(modelLine({ ...BONECO, model: "z-ai/glm-5.3-flash" })).toBe(
      "Quem respondeu agora: GLM 5.3 Flash, no lugar de GPT-6 Luna"
    );
  });

  test("says when the boneco is thinking and when it is on autopilot", () => {
    expect(modelLine({ ...BONECO, thinking: true })).toBe(
      "GPT-6 Luna está pensando…"
    );
    expect(modelLine({ ...BONECO, brain: "autopilot", model: null })).toBe(
      "No piloto automático"
    );
  });
});
