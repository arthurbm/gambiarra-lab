// Where the dynamic is, in the telão's side column: the five phases with the
// current one marked, its name and time left, and one line that says what is
// happening and what the audience does.
import type { PhaseStatus } from "@gambiarra-lab/frevo/views";
import { PhaseSteps } from "../phase/phase-steps";
import { clockText, PHASE_LABELS, TELAO_GUIDE } from "../phase/phase-text";
import "./phase-clock.css";

export function PhaseClock({ clock }: { clock: PhaseStatus }) {
  return (
    <section
      aria-label="Fase atual"
      className="phase-clock"
      data-paused={clock.paused}
    >
      <PhaseSteps phase={clock.phase} />
      <div className="phase-clock-now">
        <p className="phase-clock-name">{PHASE_LABELS[clock.phase]}</p>
        {clock.remainingMs === null ? null : (
          <p className="phase-clock-time">{clockText(clock.remainingMs)}</p>
        )}
        {clock.paused ? <p className="phase-clock-paused">pausado</p> : null}
      </div>
      {/* In the entrance the square carries the steps to join, in big letters. */}
      {clock.phase === "entrada" ? null : (
        <p className="phase-clock-guide">{TELAO_GUIDE[clock.phase]}</p>
      )}
    </section>
  );
}
