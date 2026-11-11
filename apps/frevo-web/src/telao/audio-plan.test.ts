import { describe, expect, test } from "bun:test";
import type { TelaoAudio } from "@gambiarra-lab/frevo/views";
import { audioStep, FEATURE_MS } from "./audio-plan";

function command(input: Partial<TelaoAudio>): TelaoAudio {
  return {
    id: 1,
    atMs: 0,
    ageMs: 0,
    blocoId: "bloco-1",
    url: "/audio/bloco-1.mp3",
    fallbackUrl: "/audio/reserva-2.mp3",
    ...input,
  };
}

describe("the telão's audio", () => {
  test("a new command plays its track once the sound is on", () => {
    expect(
      audioStep({ audio: command({}), handled: 0, enabled: true })
    ).toEqual({ action: "play", url: "/audio/bloco-1.mp3", handled: 1 });
    expect(
      audioStep({ audio: command({}), handled: 1, enabled: true })
    ).toEqual({ action: "none", handled: 1 });
  });

  test("playing again is a new command", () => {
    expect(
      audioStep({ audio: command({ id: 2 }), handled: 1, enabled: true })
    ).toMatchObject({ action: "play", handled: 2 });
  });

  test("before the sound is on, the command waits for the tap", () => {
    expect(
      audioStep({ audio: command({}), handled: 0, enabled: false })
    ).toEqual({ action: "none", handled: 0 });
  });

  test("an old command is skipped, as for a telão that connects later", () => {
    expect(
      audioStep({
        audio: command({ ageMs: FEATURE_MS + 1 }),
        handled: 0,
        enabled: true,
      })
    ).toEqual({ action: "none", handled: 1 });
  });

  test("a command without a track stops the sound", () => {
    expect(
      audioStep({
        audio: command({ id: 3, url: null, blocoId: null }),
        handled: 2,
        enabled: false,
      })
    ).toEqual({ action: "stop", handled: 3 });
  });

  test("no command, nothing to do", () => {
    expect(audioStep({ audio: null, handled: 0, enabled: true })).toEqual({
      action: "none",
      handled: 0,
    });
  });
});
