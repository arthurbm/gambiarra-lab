// The short log on the telão: what just happened, newest first, so nobody
// misses an invitation, a bloco forming or the maestro's call.
import type { WorldEvent } from "@gambiarra-lab/frevo/snapshot";

const SHOWN = 6;

export function EventLog({ events }: { events: WorldEvent[] }) {
  if (events.length === 0) {
    return null;
  }
  return (
    <section aria-label="O que acabou de acontecer" className="event-log">
      <h2>Agora há pouco</h2>
      <ol>
        {events
          .slice(-SHOWN)
          .reverse()
          .map((event) => (
            <li key={event.id}>{event.text}</li>
          ))}
      </ol>
    </section>
  );
}
