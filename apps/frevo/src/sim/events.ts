// The short log of what just happened, shown on the telão. Every phase writes
// to it; only text the server writes or a model wrote (already filtered) goes in.
import type { World, WorldEvent } from "./world";

/** The world with `text` as its newest event, keeping `rules.eventsKept`. */
export function logEvent(world: World, text: string): World {
  const last = world.events.at(-1);
  const event: WorldEvent = {
    id: (last?.id ?? 0) + 1,
    atMs: world.timeMs,
    text,
  };
  return {
    ...world,
    events: [...world.events, event].slice(-world.rules.eventsKept),
  };
}
