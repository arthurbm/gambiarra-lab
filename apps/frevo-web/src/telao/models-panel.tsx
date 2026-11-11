// The telão's side panel: each model of the Room with its decisions, mean
// response time and failures, from the Room's inference events.
import type { ModelPanelRow } from "@gambiarra-lab/frevo/models";
import { panelEntries } from "./models-panel-rows";

export function ModelsPanel({ rows }: { rows: ModelPanelRow[] }) {
  const entries = panelEntries(rows);
  return (
    <section aria-label="Modelos da sala" className="models-panel">
      <h2>Modelos da sala</h2>
      {entries.length === 0 ? (
        <p className="models-panel-empty">Esperando os modelos entrarem…</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th scope="col">Modelo</th>
              <th scope="col">Decisões</th>
              <th scope="col">Tempo médio</th>
              <th scope="col">Falhas</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr data-off={entry.off} key={entry.key}>
                <th scope="row">
                  {entry.label}
                  {entry.state ? (
                    <span className="models-panel-state">{entry.state}</span>
                  ) : null}
                </th>
                <td>{entry.decisions}</td>
                <td>{entry.time}</td>
                <td>{entry.failures}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
