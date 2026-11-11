import { describe, expect, test } from "bun:test";
import { otherModelLine, ownModelLabel } from "./model-line";

const BONECO = {
  assignedModel: "openai/gpt-6-luna",
  model: "openai/gpt-6-luna",
};

describe("the phone's lines about models", () => {
  test("name the boneco's own model by its label", () => {
    expect(ownModelLabel(BONECO)).toBe("GPT-6 Luna");
    expect(ownModelLabel({ ...BONECO, assignedModel: null })).toBeNull();
  });

  test("say which model answered when it was not the boneco's own", () => {
    expect(otherModelLine({ ...BONECO, model: "z-ai/glm-5.3-flash" })).toBe(
      "Quem respondeu agora: GLM 5.3 Flash, no lugar de GPT-6 Luna"
    );
  });

  test("say nothing when its own model answered or nobody did", () => {
    expect(otherModelLine(BONECO)).toBeNull();
    expect(otherModelLine({ ...BONECO, model: null })).toBeNull();
  });
});
