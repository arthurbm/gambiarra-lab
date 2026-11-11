// The short log of what just happened, shown on the telão. Every phase writes
// to it; only text the server writes or a model wrote (already filtered) goes in.
// A boneco's own line names the boneco, so the telão leaves it out while the
// host keeps that boneco silenced.
import type { World, WorldEvent } from "./world";

/**
 * The world with `text` as its newest event, keeping `rules.eventsKept`.
 * `bonecoId` is the boneco whose line `text` carries, when it carries one.
 */
export function logEvent(world: World, text: string, bonecoId?: string): World {
  const last = world.events.at(-1);
  const event: WorldEvent = {
    id: (last?.id ?? 0) + 1,
    atMs: world.timeMs,
    text,
    ...(bonecoId ? { bonecoId } : {}),
  };
  return {
    ...world,
    events: [...world.events, event].slice(-world.rules.eventsKept),
  };
}
