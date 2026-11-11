import type { PublicSnapshot } from "@gambiarra-lab/frevo/snapshot";
import type { ReactNode } from "react";
import type { StreamStatus } from "./stream";
import { useTelao } from "./use-telao";
import { WorldView } from "./world-view";

const STATUS_LABEL: Record<StreamStatus, string> = {
  connecting: "conectando…",
  live: "ao vivo",
  reconnecting: "reconectando…",
};

/**
 * The projector's layout: the square on the left, filling the screen without
 * scrolling, and a side column on the right. Panels (QR code, models, event
 * log, phase and timer) are their own components, passed as children; the
 * column stacks them in order.
 */
export function TelaoLayout({
  children,
  snapshot,
  status,
}: {
  children?: ReactNode;
  snapshot: PublicSnapshot | null;
  status: StreamStatus;
}) {
  return (
    <main className="telao">
      <section className="telao-stage">
        {snapshot ? (
          <WorldView snapshot={snapshot} />
        ) : (
          <p className="telao-waiting">Abrindo a praça…</p>
        )}
      </section>
      <aside className="telao-side">
        <header className="telao-header">
          <h1>Bloco de frevo</h1>
          <span className="telao-status" data-status={status}>
            {STATUS_LABEL[status]}
          </span>
        </header>
        {children}
      </aside>
    </main>
  );
}

/** The projector: data comes from the stream, drawing is WorldView's job. */
export function TelaoPage() {
  const { snapshot, status } = useTelao();
  return <TelaoLayout snapshot={snapshot} status={status} />;
}
