// A chosen bloco's music on the admin: being made (by which generator, for
// how long), ready, or the reserve track.
import type { TrackStatus } from "@gambiarra-lab/frevo/views";

export function trackText(track: TrackStatus): string {
  if (track.state === "pronta") {
    return "música pronta";
  }
  if (track.state === "reserva") {
    return "música de reserva";
  }
  const by = track.generator ? ` no ${track.generator}` : "";
  const seconds = Math.floor((track.runningMs ?? 0) / 1000);
  return `música sendo feita${by} há ${seconds} s`;
}
