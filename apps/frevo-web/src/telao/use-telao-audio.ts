// The telão plays the jury's music. The host's command arrives in the
// snapshot; the browser plays sound only after a tap, so the telão shows a
// button until the first one. The telão tells the server, every few seconds,
// whether its sound is on and what it plays, and the admin shows it. A track
// that does not load falls back to the embedded one.
import type { TelaoAudio } from "@gambiarra-lab/frevo/views";
import { useCallback, useEffect, useRef, useState } from "react";
import { audioStep, FEATURE_MS } from "./audio-plan";

const REPORT_MS = 5000;

function telaoId(): string {
  return `telao-${Math.random().toString(36).slice(2, 12)}`;
}

export function useTelaoAudio(audio: TelaoAudio | null | undefined) {
  const element = useRef<HTMLAudioElement | null>(null);
  const handled = useRef(0);
  const id = useRef(telaoId());
  const [enabled, setEnabled] = useState(false);
  /** The bloco whose music plays now. */
  const [playing, setPlaying] = useState<string | null>(null);

  const player = useCallback(() => {
    if (!element.current) {
      element.current = new Audio();
      element.current.preload = "auto";
    }
    return element.current;
  }, []);

  const play = useCallback(
    (url: string, fallbackUrl: string, blocoId: string | null) => {
      const el = player();
      el.onended = () => setPlaying(null);
      el.onerror = () => {
        // The generated track did not load: the embedded one plays.
        if (el.src.endsWith(fallbackUrl)) {
          setPlaying(null);
          return;
        }
        el.src = fallbackUrl;
        el.play().catch(() => setPlaying(null));
      };
      el.src = url;
      el.currentTime = 0;
      setPlaying(blocoId);
      el.play().catch(() => setPlaying(null));
    },
    [player]
  );

  useEffect(() => {
    const step = audioStep({ audio, enabled, handled: handled.current });
    handled.current = step.handled;
    if (step.action === "stop") {
      player().pause();
      setPlaying(null);
    }
    if (step.action === "play" && audio) {
      play(step.url, audio.fallbackUrl, audio.blocoId);
    }
  }, [audio, enabled, play, player]);

  /** The tap that lets the browser play sound. */
  const enable = useCallback(() => {
    const el = player();
    // Playing inside the tap unlocks the element for the commands to come.
    el.muted = true;
    el.src = audio?.fallbackUrl ?? "/audio/reserva-2.mp3";
    el.play()
      .then(() => {
        el.pause();
        el.muted = false;
      })
      .catch(() => {
        el.muted = false;
      })
      .finally(() => setEnabled(true));
  }, [audio?.fallbackUrl, player]);

  useEffect(() => {
    const report = () => {
      fetch("/api/telao/som", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          telao: id.current,
          ativo: enabled,
          tocando: playing,
        }),
      }).catch(() => {
        // The next report tries again.
      });
    };
    report();
    const timer = setInterval(report, REPORT_MS);
    return () => clearInterval(timer);
  }, [enabled, playing]);

  useEffect(() => () => element.current?.pause(), []);

  // The bloco whose refrain the stage shows: the one playing, or the one the
  // host just asked for while the sound is still off.
  const asked =
    audio?.blocoId && audio.url && audio.ageMs < FEATURE_MS
      ? audio.blocoId
      : null;
  return {
    enabled,
    enable,
    playing,
    featured: playing ?? (enabled ? null : asked),
  };
}
