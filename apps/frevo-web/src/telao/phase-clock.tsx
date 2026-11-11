// The phase and the time left, in the telão's side column.
import type { PhaseStatus } from "@gambiarra-lab/frevo/views";
import { clockText, PHASE_LABELS } from "../phase/phase-text";
import "./phase-clock.css";

export function PhaseClock({ clock }: { clock: PhaseStatus }) {
  return (
    <section
      aria-label="Fase atual"
      className="phase-clock"
      data-paused={clock.paused}
    >
      <p className="phase-clock-name">{PHASE_LABELS[clock.phase]}</p>
      {clock.remainingMs === null ? null : (
        <p className="phase-clock-time">{clockText(clock.remainingMs)}</p>
      )}
      {clock.paused ? <p className="phase-clock-paused">pausado</p> : null}
    </section>
  );
}
