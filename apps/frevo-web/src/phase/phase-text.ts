// The phase and its clock as people read them on the telão, the phone and the
// admin.
import type { PhaseStatus } from "@gambiarra-lab/frevo/views";

export const PHASE_LABELS: Record<PhaseStatus["phase"], string> = {
  entrada: "Entrada",
  formar: "Conhecer e formar",
  compor: "Compor",
  desfile: "Desfile e júri",
  final: "Final",
};

type Phase = PhaseStatus["phase"];
const ORDER = Object.keys(PHASE_LABELS) as Phase[];

export function nextPhase(phase: Phase): Phase | null {
  return ORDER[ORDER.indexOf(phase) + 1] ?? null;
}

/** Minutes and seconds left, rounding up so "0:00" means the time is up. */
export function clockText(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function phaseLine(status: PhaseStatus): string {
  const parts = [PHASE_LABELS[status.phase]];
  if (status.remainingMs !== null) {
    parts.push(clockText(status.remainingMs));
  }
  if (status.paused) {
    parts.push("pausado");
  }
  return parts.join(" · ");
}
