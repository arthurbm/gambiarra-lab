// What the telão does with the host's last audio command, kept apart from the
// <audio> element so it can be tested without a browser. Each command has a
// growing id; playing again is a new one. The browser plays sound only after
// a tap on the page, so a command that comes before the tap waits for it.
import type { TelaoAudio } from "@gambiarra-lab/frevo/views";

/** A command older than this is not played: the moment passed. */
export const FEATURE_MS = 40_000;

export type AudioStep =
  | { action: "none"; handled: number }
  | { action: "play"; handled: number; url: string }
  | { action: "stop"; handled: number };

export function audioStep(input: {
  audio: TelaoAudio | null | undefined;
  enabled: boolean;
  /** The id of the last command already acted on. */
  handled: number;
}): AudioStep {
  const { audio, enabled, handled } = input;
  if (!audio || audio.id <= handled) {
    return { action: "none", handled };
  }
  if (audio.url === null) {
    return { action: "stop", handled: audio.id };
  }
  if (audio.ageMs > FEATURE_MS) {
    return { action: "none", handled: audio.id };
  }
  if (!enabled) {
    return { action: "none", handled };
  }
  return { action: "play", url: audio.url, handled: audio.id };
}
