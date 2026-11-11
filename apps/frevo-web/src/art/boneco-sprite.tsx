// One boneco as a CSS sprite, for screens that show a single boneco (the
// phone). Same character sheets and costume as the telão, without a canvas.
import type { Facing } from "@gambiarra-lab/frevo/snapshot";
import type { CSSProperties } from "react";
import {
  characterSheetUrl,
  FACING_COLUMN,
  FRAME,
  type Instrument,
  instrumentOf,
} from "./characters";
import { InstrumentIcon } from "./instrument-icon";

export function BonecoSprite({
  className,
  facing = "down",
  instrument,
  label,
  look,
  scale = 4,
  walking = false,
}: {
  className?: string;
  facing?: Facing;
  /** Unknown or missing: no costume. */
  instrument?: Instrument | string | null;
  /** Accessible name; the sprite is decorative without it. */
  label?: string;
  /** Index of the character, as `lookOf` returns it. */
  look: number;
  /** Screen pixels per art pixel; keep it whole so the art stays sharp. */
  scale?: number;
  walking?: boolean;
}) {
  const size = FRAME * Math.max(1, Math.round(scale));
  const costume = instrumentOf(instrument);
  return (
    <span
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true })}
      className={["boneco-sprite", className].filter(Boolean).join(" ")}
      data-walking={walking}
      style={
        {
          "--boneco-size": `${size}px`,
          backgroundImage: `url(${characterSheetUrl(look)})`,
          backgroundPositionX: `${-FACING_COLUMN[facing] * size}px`,
          backgroundPositionY: 0,
        } as CSSProperties
      }
    >
      {costume ? (
        <InstrumentIcon
          className="boneco-sprite-instrument"
          instrument={costume}
        />
      ) : null}
    </span>
  );
}
