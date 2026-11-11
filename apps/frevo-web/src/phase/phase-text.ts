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
/** The phases in the order they happen. */
export const PHASE_ORDER: readonly Phase[] = ORDER;

/** One word per phase, for the row of steps. */
export const PHASE_SHORT: Record<Phase, string> = {
  entrada: "Entrada",
  formar: "Blocos",
  compor: "Compor",
  desfile: "Desfile",
  final: "Final",
};

/** "Etapa 2 de 5: Conhecer e formar". */
export function phasePosition(phase: Phase): string {
  return `Etapa ${ORDER.indexOf(phase) + 1} de ${ORDER.length}: ${PHASE_LABELS[phase]}`;
}

/** What happens in each phase and what the audience does, on the telão. */
export const TELAO_GUIDE: Record<Phase, string> = {
  entrada:
    "Escaneie o QR com o celular, diga seu nome e ganhe um boneco na praça.",
  formar:
    "Os bonecos conversam e formam blocos de três. Se o seu te chamar, responda no celular.",
  compor:
    "Cada bloco escolhe nome e refrão. Vote no celular, ou escreva outro nome.",
  desfile:
    "Um bloco por vez no palco, com seu refrão. O júri escolhe até três.",
  final: "Fim do desfile. Estes são os blocos de hoje.",
};

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
