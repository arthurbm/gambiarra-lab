import type { StreamStatus } from "./stream";
import { useTelao } from "./use-telao";
import { WorldView } from "./world-view";

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "conectando…",
  live: "ao vivo",
  reconnecting: "reconectando…",
};

/** The projector: data comes from the stream, drawing is WorldView's job. */
export function TelaoPage() {
  const { snapshot, status } = useTelao();
  return (
    <main className="telao">
      <header className="telao-header">
        <h1>Bloco de frevo</h1>
        <span className="telao-status" data-status={status}>
          {STATUS_LABEL[status]}
        </span>
      </header>
      <section className="telao-stage">
        {snapshot ? (
          <WorldView snapshot={snapshot} />
        ) : (
          <p className="telao-waiting">Abrindo a praça…</p>
        )}
      </section>
    </main>
  );
}
