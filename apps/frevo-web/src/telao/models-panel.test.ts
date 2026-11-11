import { describe, expect, test } from "bun:test";
import type { ModelPanelRow } from "@gambiarra-lab/frevo/models";
import { panelEntries } from "./models-panel-rows";

const ROW: ModelPanelRow = {
  model: "openai/gpt-6-luna",
  label: "GPT-6 Luna",
  participants: 3,
  enabled: true,
  decisions: 41,
  failures: 2,
  avgMs: 1342,
  thinking: 1,
};

describe("the models panel", () => {
  test("shows decisions, the mean response time in seconds and failures", () => {
    expect(panelEntries([ROW])).toEqual([
      {
        key: "openai/gpt-6-luna",
        label: "GPT-6 Luna",
        decisions: "41",
        time: "1,3 s",
        failures: "2",
        state: "1 pensando",
        off: false,
      },
    ]);
  });

  test("says when a model has not answered yet and when it was switched off", () => {
    const [entry] = panelEntries([
      {
        ...ROW,
        decisions: 0,
        failures: 0,
        avgMs: null,
        thinking: 0,
        enabled: false,
      },
    ]);
    expect(entry).toMatchObject({ time: "—", state: "desligado", off: true });
  });

  test("puts the busiest models first", () => {
    const entries = panelEntries([
      { ...ROW, model: "a", label: "A", decisions: 3 },
      { ...ROW, model: "b", label: "B", decisions: 9 },
    ]);
    expect(entries.map((entry) => entry.label)).toEqual(["B", "A"]);
  });
});
