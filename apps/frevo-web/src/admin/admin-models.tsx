// The admin's models section: spending against the ceiling, with a warning
// once it is reached, and a switch per model. The full admin screen is the
// admin ticket's; this section only needs /api/admin/models.
import type { ModelPanelRow } from "@gambiarra-lab/frevo/models";
import { useCallback, useEffect, useState } from "react";

interface AdminModels {
  models: ModelPanelRow[];
  spending: { ceilingUsd: number; exceeded: boolean; spentUsd: number };
}

const REFRESH_MS = 3000;
const dollars = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

async function request(
  secret: string,
  path: string,
  body?: unknown
): Promise<AdminModels> {
  const response = await fetch(`/api/admin${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401
        ? "Link do admin sem o segredo certo."
        : `O servidor respondeu ${response.status}.`
    );
  }
  return (await response.json()) as AdminModels;
}

export function AdminModelsSection({ secret }: { secret: string }) {
  const [state, setState] = useState<AdminModels | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const run = useCallback(
    (path: string, body?: unknown) =>
      request(secret, path, body)
        .then((next) => {
          setState(next);
          setProblem(null);
        })
        .catch((error: Error) => setProblem(error.message)),
    [secret]
  );

  useEffect(() => {
    run("/models");
    const timer = setInterval(() => run("/models"), REFRESH_MS);
    return () => clearInterval(timer);
  }, [run]);

  return (
    <section className="admin-models">
      <h2>Modelos e gasto</h2>
      {problem ? <p className="admin-warning">{problem}</p> : null}
      {state ? (
        <>
          <p>
            Gasto estimado: {dollars.format(state.spending.spentUsd)} de{" "}
            {dollars.format(state.spending.ceilingUsd)}
          </p>
          {state.spending.exceeded ? (
            <p className="admin-warning" role="alert">
              O teto de gasto foi atingido: todos os bonecos estão no piloto
              automático.{" "}
              <button onClick={() => run("/spending/reset", {})} type="button">
                Zerar o gasto
              </button>
            </p>
          ) : null}
          <ul className="admin-models-list">
            {state.models.map((row) => (
              <li data-off={!row.enabled} key={row.model}>
                <div>
                  <strong>{row.label}</strong>
                  <small>
                    {row.participants} participants · {row.decisions} decisões ·{" "}
                    {row.failures} falhas
                    {row.enabled ? "" : " · desligado"}
                  </small>
                </div>
                <button
                  onClick={() =>
                    run("/models", {
                      model: row.model,
                      enabled: !row.enabled,
                    })
                  }
                  type="button"
                >
                  {row.enabled ? "Desligar" : "Ligar"}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
