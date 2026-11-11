// The five phases in a row with the current one marked, so the telão, the
// phone and the admin all answer "where are we?" the same way.
import type { PhaseStatus } from "@gambiarra-lab/frevo/views";
import { PHASE_ORDER, PHASE_SHORT, phasePosition } from "./phase-text";
import "./phase-steps.css";

type Phase = PhaseStatus["phase"];

function stateOf(index: number, current: number): "current" | "done" | "next" {
  if (index === current) {
    return "current";
  }
  return index < current ? "done" : "next";
}

export function PhaseSteps({ phase }: { phase: Phase }) {
  const current = PHASE_ORDER.indexOf(phase);
  return (
    <ol aria-label={phasePosition(phase)} className="phase-steps">
      {PHASE_ORDER.map((step, index) => (
        <li
          aria-current={index === current ? "step" : undefined}
          data-state={stateOf(index, current)}
          key={step}
        >
          <span className="phase-steps-dot">{index + 1}</span>
          <span className="phase-steps-label">{PHASE_SHORT[step]}</span>
        </li>
      ))}
    </ol>
  );
}
