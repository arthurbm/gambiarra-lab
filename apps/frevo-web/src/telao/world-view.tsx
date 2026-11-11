// Draws the world. It knows nothing about the stream: it gets snapshots and
// keeps them in refs, and a single animation loop paints the canvas and moves
// the balloons. React only mounts and unmounts balloons.
import {
  DEFAULT_RULES,
  type PublicBoneco,
  type PublicSnapshot,
} from "@gambiarra-lab/frevo/snapshot";
import { useEffect, useRef, useState } from "react";
import { FRAME, instrumentOf, lookOf, walkFrame } from "../art/characters";
import { type Balloon, layoutBalloons, type Speaker } from "./balloons";
import { type Drawn, follow } from "./motion";
import {
  type Art,
  type Figure,
  loadArt,
  paintFrame,
  paintGround,
} from "./painter";
import { fitWorld, type WorldFit } from "./scale";
import { PX_PER_UNIT, WORLD_HEIGHT, WORLD_WIDTH } from "./scene";

/** The look and costume arrive with the entrance; until then they may be missing. */
export type ArtBoneco = PublicBoneco & {
  instrument?: string | null;
  look?: number | null;
};

const FOLLOW = {
  speed: DEFAULT_RULES.speed,
  /** Four tiles. */
  teleportDistance: (4 * 16) / PX_PER_UNIT,
};
const LAYOUT_MS = 250;
const MAX_BALLOONS = 5;

interface Speech {
  seenAt: number;
  text: string;
}

function sameBalloons(a: Balloon[], b: Balloon[]) {
  return (
    a.length === b.length &&
    a.every(
      (balloon, index) =>
        balloon.id === b[index]?.id &&
        balloon.text === b[index]?.text &&
        balloon.slot === b[index]?.slot &&
        balloon.width === b[index]?.width
    )
  );
}

export function WorldView({ snapshot }: { snapshot: PublicSnapshot }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef(snapshot);
  const speechRef = useRef(new Map<string, Speech>());
  const balloonElements = useRef(new Map<string, HTMLElement>());
  const layoutRef = useRef<Balloon[]>([]);
  const [art, setArt] = useState<Art | null>(null);
  const [fit, setFit] = useState<WorldFit | null>(null);
  const [balloons, setBalloons] = useState<Balloon[]>([]);

  // Remember when each speech first appeared: the newest wins a balloon.
  useEffect(() => {
    snapshotRef.current = snapshot;
    const now = performance.now();
    const speeches = speechRef.current;
    for (const boneco of snapshot.bonecos) {
      if (!boneco.speech) {
        speeches.delete(boneco.id);
      } else if (speeches.get(boneco.id)?.text !== boneco.speech) {
        speeches.set(boneco.id, { text: boneco.speech, seenAt: now });
      }
    }
  }, [snapshot]);

  useEffect(() => {
    let cancelled = false;
    loadArt().then(
      (loaded) => {
        if (!cancelled) {
          setArt(loaded);
        }
      },
      (error: unknown) => console.error(error)
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return;
    }
    const measure = () => {
      const box = stage.getBoundingClientRect();
      setFit(
        fitWorld({
          width: WORLD_WIDTH,
          height: WORLD_HEIGHT,
          stageWidth: box.width,
          stageHeight: box.height,
          devicePixelRatio: window.devicePixelRatio,
        })
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!(canvas && ctx && art && fit)) {
      return;
    }
    canvas.width = fit.canvasWidth;
    canvas.height = fit.canvasHeight;
    const ground = paintGround(art, fit);
    const drawn = new Map<string, Drawn>();
    const css = fit.cssPerDevicePixel;
    const toCss = (x: number, y: number) => ({
      x: (fit.originX + x * fit.scale) * css,
      y: (fit.originY + y * fit.scale) * css,
    });
    const area = toCss(0, 0);
    const fontSize = Math.round(fit.scale * 6.5 * css);
    let last = performance.now();
    let lastLayout = 0;
    let frame = 0;

    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      const { current } = snapshotRef;
      const live = new Set<string>();
      const positions = current.bonecos.map((raw) => {
        const boneco = raw as ArtBoneco;
        live.add(boneco.id);
        const next = follow(
          drawn.get(boneco.id),
          {
            x: boneco.x * PX_PER_UNIT,
            y: boneco.y * PX_PER_UNIT,
            facing: boneco.facing,
          },
          elapsed,
          {
            speed: FOLLOW.speed * PX_PER_UNIT,
            teleportDistance: FOLLOW.teleportDistance * PX_PER_UNIT,
          }
        );
        drawn.set(boneco.id, next);
        return { boneco, at: next };
      });
      for (const id of drawn.keys()) {
        if (!live.has(id)) {
          drawn.delete(id);
        }
      }

      if (now - lastLayout >= LAYOUT_MS) {
        lastLayout = now;
        const speakers: Speaker[] = positions.flatMap(({ boneco, at }) => {
          const speech = speechRef.current.get(boneco.id);
          if (!speech) {
            return [];
          }
          const head = toCss(at.x, at.y - FRAME);
          return [
            {
              id: boneco.id,
              name: boneco.name,
              text: speech.text,
              seenAt: speech.seenAt,
              headX: head.x - area.x,
              headY: head.y - area.y,
              footY: toCss(at.x, at.y + 8).y - area.y,
            },
          ];
        });
        const laid = layoutBalloons(
          speakers,
          {
            width: WORLD_WIDTH * fit.scale * css,
            height: WORLD_HEIGHT * fit.scale * css,
          },
          {
            fontSize,
            max: MAX_BALLOONS,
            maxWidth: Math.round(WORLD_WIDTH * fit.scale * css * 0.28),
          }
        );
        // Keep each balloon's offset from its boneco; the loop moves it along.
        layoutRef.current = laid.balloons.map((balloon) => {
          const speaker = speakers.find((one) => one.id === balloon.id);
          return {
            ...balloon,
            left: balloon.left - (speaker?.headX ?? 0),
            top: balloon.top - (speaker?.headY ?? 0),
          };
        });
        setBalloons((previous) =>
          sameBalloons(previous, layoutRef.current)
            ? previous
            : layoutRef.current
        );
      }

      const figures: Figure[] = positions.map(({ boneco, at }) => ({
        id: boneco.id,
        name: boneco.name,
        look: lookOf(boneco),
        instrument: instrumentOf(boneco.instrument),
        x: at.x,
        y: at.y,
        facing: at.facing,
        walkFrame: at.walking || boneco.walking ? walkFrame(now, boneco.id) : 0,
        thinking: boneco.thinking,
      }));
      paintFrame(ctx, fit, art, ground, figures, now);

      for (const balloon of layoutRef.current) {
        const element = balloonElements.current.get(balloon.id);
        const at = drawn.get(balloon.id);
        if (element && at) {
          const head = toCss(at.x, at.y - FRAME);
          const width = WORLD_WIDTH * fit.scale * css;
          const left = Math.min(
            Math.max(head.x - area.x + balloon.left, 0),
            width - balloon.width
          );
          element.style.transform = `translate(${Math.round(area.x + left)}px, ${Math.round(head.y + balloon.top)}px)`;
          element.style.visibility = "visible";
          element.style.setProperty(
            "--tail-x",
            `${Math.round(head.x - area.x - left)}px`
          );
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [art, fit]);

  const css = fit?.cssPerDevicePixel ?? 1;
  return (
    <div
      className="world"
      ref={stageRef}
      style={
        fit
          ? ({
              "--balloon-font": `${Math.round(fit.scale * 6.5 * css)}px`,
            } as React.CSSProperties)
          : undefined
      }
    >
      <canvas
        aria-label="A praça do Bloco de frevo"
        className="world-canvas"
        ref={canvasRef}
        style={
          fit
            ? {
                width: `${fit.canvasWidth * css}px`,
                height: `${fit.canvasHeight * css}px`,
              }
            : undefined
        }
      />
      {balloons.map((balloon) => (
        <p
          className="world-balloon"
          data-slot={balloon.slot}
          key={balloon.id}
          ref={(element) => {
            if (element) {
              balloonElements.current.set(balloon.id, element);
            } else {
              balloonElements.current.delete(balloon.id);
            }
          }}
          style={{ width: `${balloon.width}px` }}
        >
          <strong>{balloon.name}</strong>
          <span>{balloon.text}</span>
        </p>
      ))}
    </div>
  );
}
