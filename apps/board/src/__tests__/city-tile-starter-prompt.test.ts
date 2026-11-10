import { expect, test } from "bun:test";

import { withCityTileStarter } from "../harness-runtime";
import { cityTileStarterFiles } from "../starter/city-tile";

const ownHarness = { harnessId: "opencode", hosted: false, model: "OpenCode" };

test("puts the full starter before the first prompt of a person's harness", () => {
  const text = withCityTileStarter(ownHarness, "Build the square");

  for (const file of cityTileStarterFiles({
    harness: "opencode",
    model: "OpenCode",
  })) {
    expect(text).toContain(`--- ${file.path} ---\n${file.content.trimEnd()}`);
  }
  expect(text).toContain("Never overwrite a file that already exists.");
  expect(text.endsWith("Task:\nBuild the square")).toBe(true);
});

test("derives the starter palette from the harness and model", () => {
  const opencode = withCityTileStarter(ownHarness, "x");
  const codex = withCityTileStarter(
    { harnessId: "codex", hosted: false, model: "gpt" },
    "x"
  );

  expect(opencode).not.toBe(codex);
});

test("leaves prompts to hosted or unknown harnesses unchanged", () => {
  expect(
    withCityTileStarter({ ...ownHarness, hosted: true }, "Build the square")
  ).toBe("Build the square");
  expect(withCityTileStarter(undefined, "Build the square")).toBe(
    "Build the square"
  );
});
