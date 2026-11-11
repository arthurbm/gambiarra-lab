// The simulation may put several bonecos on the very same point (everyone
// walking to the stage). On screen they would become one sprite, so the telão
// pushes overlapping bonecos apart a little. Drawing only: the world is not
// touched. The same crowd always fans out the same way.
import { hashId } from "../art/characters";

const PASSES = 8;
/** Prefer side by side to one behind the other. */
const VERTICAL_PUSH = 0.7;

function direction(a: string, b: string) {
  const angleA = ((hashId(a) % 360) * Math.PI) / 180;
  const angleB = ((hashId(b) % 360) * Math.PI) / 180;
  const x = Math.cos(angleA) - Math.cos(angleB);
  const y = Math.sin(angleA) - Math.sin(angleB);
  const length = Math.hypot(x, y);
  return length > 1e-6 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
}

interface Point {
  id: string;
  x: number;
  y: number;
}
interface Offset {
  x: number;
  y: number;
}

/** Moves two bonecos apart, half each, when they are too close. */
function separate(
  a: Point,
  b: Point,
  offsetA: Offset,
  offsetB: Offset,
  minDistance: number
) {
  const dx = b.x + offsetB.x - (a.x + offsetA.x);
  const dy = b.y + offsetB.y - (a.y + offsetA.y);
  const distance = Math.hypot(dx, dy);
  if (distance >= minDistance) {
    return;
  }
  const away =
    distance > 1e-3
      ? { x: dx / distance, y: dy / distance }
      : direction(b.id, a.id);
  const push = (minDistance - distance) / 2;
  offsetA.x -= away.x * push;
  offsetA.y -= away.y * push * VERTICAL_PUSH;
  offsetB.x += away.x * push;
  offsetB.y += away.y * push * VERTICAL_PUSH;
}

/** Offsets that keep bonecos at least about `minDistance` apart. */
export function spreadOut(
  points: Point[],
  minDistance: number
): Map<string, Offset> {
  const entries = points.map((point) => ({ point, offset: { x: 0, y: 0 } }));
  for (let pass = 0; pass < PASSES; pass += 1) {
    for (const [index, a] of entries.entries()) {
      for (const b of entries.slice(index + 1)) {
        separate(a.point, b.point, a.offset, b.offset, minDistance);
      }
    }
  }
  return new Map(entries.map(({ point, offset }) => [point.id, offset]));
}
