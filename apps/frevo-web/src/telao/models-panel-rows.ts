// What the models panel writes for each model; kept apart from the drawing so
// it can be tested without a browser.
import type { ModelPanelRow } from "@gambiarra-lab/frevo/models";

export interface PanelEntry {
  decisions: string;
  failures: string;
  key: string;
  label: string;
  off: boolean;
  state: string;
  time: string;
}

const seconds = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

function state(row: ModelPanelRow) {
  if (!row.enabled) {
    return "desligado";
  }
  return row.thinking > 0 ? `${row.thinking} pensando` : "";
}

export function panelEntries(rows: ModelPanelRow[]): PanelEntry[] {
  return [...rows]
    .sort((a, b) => b.decisions - a.decisions || a.label.localeCompare(b.label))
    .map((row) => ({
      key: row.model,
      label: row.label,
      decisions: String(row.decisions),
      time: row.avgMs === null ? "—" : `${seconds.format(row.avgMs / 1000)} s`,
      failures: String(row.failures),
      state: state(row),
      off: !row.enabled,
    }));
}
