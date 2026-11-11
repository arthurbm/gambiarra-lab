import { describe, expect, test } from "bun:test";
import { isConventional, violations } from "./conventional-commits";

describe("conventional commits", () => {
  test("accepts type, optional scope, optional bang and a subject", () => {
    for (const subject of [
      "feat(board): add round timer",
      "fix: keep the hub port",
      "chore(frevo): follow main on Railway",
      "refactor(sim)!: drop the old phase names",
      "docs(bloco-de-frevo/notas): add the notes",
      "ci: run the smoke",
    ]) {
      expect(isConventional(subject)).toBe(true);
    }
  });

  test("refuses everything else", () => {
    for (const subject of [
      "Merge branch 'main' into feat/x",
      "Add round timer",
      "feat add round timer",
      "feature(board): add round timer",
      "feat(Board): add round timer",
      "feat(): empty scope",
      "feat:no space",
      "feat: ",
      "Feat: capital type",
    ]) {
      expect(isConventional(subject)).toBe(false);
    }
  });

  test("lists the title and each commit that breaks the rule", () => {
    expect(
      violations({
        title: "Bloco de frevo",
        commits: ["abc1234 feat(frevo): add the world", "def5678 wip"],
      })
    ).toEqual(["PR title: Bloco de frevo", "commit def5678 wip"]);
    expect(
      violations({ title: "feat: ok", commits: ["abc1234 fix: ok"] })
    ).toEqual([]);
  });
});
