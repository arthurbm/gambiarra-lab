// What the host does to one boneco from the admin: silence it (its lines no
// longer reach the telão) or expel it (it leaves the world, and the phases
// drop it from what they keep, such as its bloco). A person leaving from their
// phone takes the same way out; only the server decides whether they may
// come back.
import type { World } from "./world";

/**
 * Runs after a boneco left the world. A phase that keeps bonecos elsewhere
 * (a bloco, a vote) registers here to drop the one that left.
 */
export const BONECO_REMOVED_HOOKS: ((
  world: World,
  bonecoId: string
) => World)[] = [];

export function setSilenced(
  world: World,
  bonecoId: string,
  silenced: boolean
): World {
  return {
    ...world,
    bonecos: world.bonecos.map((boneco) =>
      boneco.id === bonecoId ? { ...boneco, silenced } : boneco
    ),
  };
}

/** Removes a boneco; returns its phone's session so the phone can be told. */
export function expel(
  world: World,
  bonecoId: string
): { sessionId: string | null; world: World } {
  const boneco = world.bonecos.find((other) => other.id === bonecoId);
  if (!boneco) {
    return { world, sessionId: null };
  }
  let next: World = {
    ...world,
    bonecos: world.bonecos.filter((other) => other.id !== bonecoId),
  };
  for (const hook of BONECO_REMOVED_HOOKS) {
    next = hook(next, bonecoId);
  }
  return { world: next, sessionId: boneco.sessionId };
}

/**
 * The person behind this session leaves the square: their boneco goes the
 * way an expelled one does. Returns the boneco that left, or null.
 */
export function leave(
  world: World,
  sessionId: string
): { bonecoId: string | null; world: World } {
  const boneco = world.bonecos.find((other) => other.sessionId === sessionId);
  if (!boneco) {
    return { world, bonecoId: null };
  }
  return { world: expel(world, boneco.id).world, bonecoId: boneco.id };
}
