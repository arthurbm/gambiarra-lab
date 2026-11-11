// One row per model of the Room, as the telão's panel and the admin show it.
// Types only travel to the web; the rows are built on the world server.
import { modelLabel } from "./catalog";

export interface ModelPanelRow {
  /** Mean response time in ms; null before the first answer. */
  avgMs: number | null;
  decisions: number;
  enabled: boolean;
  failures: number;
  label: string;
  model: string;
  /** Participants of this model in the Room. */
  participants: number;
  /** Calls waiting for this model right now. */
  thinking: number;
}

export interface ModelPanelInput {
  available: { enabled: boolean; model: string; participants: number }[];
  stats: {
    avgMs: number | null;
    decisions: number;
    failures: number;
    fromEvents: number;
    inFlight: number;
    model: string;
  }[];
}

/** The models in the Room, plus any that answered before and left. */
export function modelPanelRows(
  input: ModelPanelInput
): (ModelPanelRow & { fromEvents: number })[] {
  const stats = new Map(input.stats.map((row) => [row.model, row]));
  const models = new Map(input.available.map((row) => [row.model, row]));
  const ids = [...new Set([...models.keys(), ...stats.keys()])].sort((a, b) =>
    a.localeCompare(b)
  );
  return ids.map((model) => {
    const counted = stats.get(model);
    const available = models.get(model);
    return {
      model,
      label: modelLabel(model),
      participants: available?.participants ?? 0,
      enabled: available?.enabled ?? true,
      decisions: counted?.decisions ?? 0,
      failures: counted?.failures ?? 0,
      avgMs: counted?.avgMs ?? null,
      thinking: counted?.inFlight ?? 0,
      fromEvents: counted?.fromEvents ?? 0,
    };
  });
}
