// Which bonecos get a speech balloon and where it goes. A projector shows
// only a handful of readable balloons at once, so the newest speech wins and
// the others get none. Each balloon tries a few spots around its boneco and
// takes the first that does not cover one already placed.
// All sizes are estimated from the font size, so this runs without the DOM.

export interface Speaker {
  /** Where the boneco's feet are, for a balloon below it. */
  footY: number;
  /** Top centre of the boneco's head. */
  headX: number;
  headY: number;
  id: string;
  name: string;
  /** When the client first saw this speech; newer is more important. */
  seenAt: number;
  text: string;
}

export type BalloonSlot = "above" | "above-left" | "above-right" | "below";

export interface Balloon {
  height: number;
  id: string;
  left: number;
  name: string;
  slot: BalloonSlot;
  /** Where the tail points, relative to `left`. */
  tailX: number;
  text: string;
  top: number;
  width: number;
}

export interface BalloonStyle {
  fontSize: number;
  max: number;
  maxWidth: number;
}

/** Average width of a bold sans-serif character, in ems. */
const CHAR_EM = 0.56;
const LINE_EM = 1.2;
const NAME_EM = 0.95;
const PAD_X_EM = 0.6;
const PAD_Y_EM = 0.35;
const GAP_EM = 0.5;
const LINES = 2;
/** Word wrapping wastes part of each line. */
const WRAP_FILL = 0.85;
const SPACING = 4;
const WORD_END = /\s+\S*$/;

function cut(text: string, maxChars: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) {
    return clean;
  }
  const head = clean.slice(0, maxChars - 1);
  const atWord = head.replace(WORD_END, "");
  return `${(atWord.length > maxChars / 2 ? atWord : head).trimEnd()}…`;
}

function measure(speaker: Speaker, style: BalloonStyle) {
  const char = style.fontSize * CHAR_EM;
  const padX = style.fontSize * PAD_X_EM;
  const perLine = Math.max(8, Math.floor((style.maxWidth - 2 * padX) / char));
  const text = cut(speaker.text, Math.floor(perLine * LINES * WRAP_FILL));
  const lines = Math.min(LINES, Math.ceil(text.length / perLine));
  const longest = Math.max(
    Math.min(text.length, perLine),
    speaker.name.length * NAME_EM
  );
  return {
    text,
    width: Math.min(style.maxWidth, Math.ceil(longest * char + 2 * padX)),
    height: Math.ceil(
      style.fontSize * (NAME_EM * LINE_EM + lines * LINE_EM + 2 * PAD_Y_EM)
    ),
  };
}

type Box = Pick<Balloon, "height" | "left" | "top" | "width">;

function overlaps(a: Box, b: Box) {
  return (
    a.left < b.left + b.width + SPACING &&
    b.left < a.left + a.width + SPACING &&
    a.top < b.top + b.height + SPACING &&
    b.top < a.top + a.height + SPACING
  );
}

function candidates(
  speaker: Speaker,
  size: { height: number; width: number },
  gap: number
): Array<{ left: number; slot: BalloonSlot; top: number }> {
  const above = speaker.headY - gap - size.height;
  const below = speaker.footY + gap;
  return [
    { slot: "above", left: speaker.headX - size.width / 2, top: above },
    {
      slot: "above-right",
      left: speaker.headX - size.width * 0.15,
      top: above,
    },
    { slot: "above-left", left: speaker.headX - size.width * 0.85, top: above },
    { slot: "below", left: speaker.headX - size.width / 2, top: below },
  ];
}

export function layoutBalloons(
  speakers: Speaker[],
  area: { height: number; width: number },
  style: BalloonStyle
): { balloons: Balloon[]; hidden: string[] } {
  const ordered = [...speakers].sort((a, b) => b.seenAt - a.seenAt);
  const balloons: Balloon[] = [];
  const hidden: string[] = [];
  const gap = style.fontSize * GAP_EM;
  for (const speaker of ordered) {
    if (balloons.length >= style.max) {
      hidden.push(speaker.id);
      continue;
    }
    const size = measure(speaker, style);
    const placed = candidates(speaker, size, gap)
      .map((spot) => ({
        ...spot,
        left: Math.round(
          Math.min(Math.max(spot.left, 0), area.width - size.width)
        ),
        top: Math.round(spot.top),
      }))
      .find(
        (spot) =>
          spot.top >= 0 &&
          spot.top + size.height <= area.height &&
          !balloons.some((other) => overlaps(other, { ...spot, ...size }))
      );
    if (!placed) {
      hidden.push(speaker.id);
      continue;
    }
    balloons.push({
      id: speaker.id,
      name: speaker.name,
      text: size.text,
      width: size.width,
      height: size.height,
      left: placed.left,
      top: placed.top,
      slot: placed.slot,
      tailX: Math.min(
        Math.max(speaker.headX - placed.left, gap),
        size.width - gap
      ),
    });
  }
  return { balloons, hidden };
}
