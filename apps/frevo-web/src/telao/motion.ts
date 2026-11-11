// The telão gets a snapshot five times a second; drawing only those positions
// would make bonecos hop. Each boneco is drawn chasing its latest position at
// a capped speed instead, so it walks at a steady pace, tolerates a late or
// lost snapshot and needs no server clock. Facing and the walk cycle come from
// the drawn movement, not from the data.
import type { Facing } from "@gambiarra-lab/frevo/snapshot";

export interface Drawn {
  facing: Facing;
  walking: boolean;
  x: number;
  y: number;
}

export interface FollowRules {
  /** The simulation's walking speed, in map units per second. */
  speed: number;
  /** Farther than this, the boneco is moved at once (a new phase, a join). */
  teleportDistance: number;
}

const MAX_FRAME_MS = 100;
/** Slack over the walking speed, so a drawn boneco keeps up. */
const SPEED_SLACK = 1.2;
/** A lagging boneco covers this share of the gap per second. */
const CATCH_UP_PER_SECOND = 3;
/** Change axis on a diagonal only when the other axis is this much larger. */
const TURN_RATIO = 1.2;
const ARRIVED = 1e-3;

function facingOf(dx: number, dy: number, current: Drawn | undefined): Facing {
  const across = Math.abs(dx);
  const along = Math.abs(dy);
  let horizontal = across >= along;
  if (current?.walking) {
    // Keep the current axis until the other one clearly wins.
    horizontal =
      current.facing === "left" || current.facing === "right"
        ? along <= across * TURN_RATIO
        : across > along * TURN_RATIO;
  }
  if (horizontal) {
    return dx > 0 ? "right" : "left";
  }
  return dy > 0 ? "down" : "up";
}

export function follow(
  drawn: Drawn | undefined,
  target: { facing: Facing; x: number; y: number },
  elapsedMs: number,
  rules: FollowRules
): Drawn {
  const dx = target.x - (drawn?.x ?? target.x);
  const dy = target.y - (drawn?.y ?? target.y);
  const distance = Math.hypot(dx, dy);
  if (!drawn || distance <= ARRIVED || distance > rules.teleportDistance) {
    return { x: target.x, y: target.y, facing: target.facing, walking: false };
  }
  const seconds = Math.min(elapsedMs, MAX_FRAME_MS) / 1000;
  const reach =
    Math.max(rules.speed * SPEED_SLACK, distance * CATCH_UP_PER_SECOND) *
    seconds;
  if (reach >= distance) {
    return { x: target.x, y: target.y, facing: target.facing, walking: false };
  }
  return {
    x: drawn.x + (dx / distance) * reach,
    y: drawn.y + (dy / distance) * reach,
    facing: facingOf(dx, dy, drawn),
    walking: true,
  };
}
