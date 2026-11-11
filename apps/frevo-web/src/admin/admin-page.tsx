// The host's controls, made for a phone on the stage: the phase and its clock
// always on top, big buttons, and a second tap before anything that cannot
// be undone. The link carries the secret as `/admin?k=<secret>`.
import type {
  AdminBoneco,
  AdminState,
  PhaseStatus,
} from "@gambiarra-lab/frevo/views";
import { useEffect, useState } from "react";
import { clockText, nextPhase, PHASE_LABELS } from "../phase/phase-text";
import { AdminModelsSection } from "./admin-models";
import { adminSecret, useAdmin } from "./use-admin";
import "./admin.css";

type Act = (route: string, body?: Record<string, unknown>) => Promise<boolean>;

const STEP_MS = 30_000;
const MIN_MS = 30_000;
const CONFIRM_MS = 5000;
const DEFAULT_SIMULATED = 25;
const TIMED = ["formar", "compor", "desfile"] as const;

const dollars = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});

/** A button that asks for a second tap within a few seconds. */
function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  className,
}: {
  className?: string;
  confirmLabel: string;
  label: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) {
      return;
    }
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  if (!armed) {
    return (
      <button
        className={className}
        onClick={() => setArmed(true)}
        type="button"
      >
        {label}
      </button>
    );
  }
  return (
    <span className="admin-confirm">
      <button
        className="admin-danger"
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
        type="button"
      >
        {confirmLabel}
      </button>
      <button onClick={() => setArmed(false)} type="button">
        Cancelar
      </button>
    </span>
  );
}

function StatusBar({
  state,
  connection,
}: {
  connection: string;
  state: AdminState;
}) {
  const { clock, people, spending } = state;
  return (
    <header className="admin-bar" data-paused={clock.paused}>
      <div className="admin-bar-phase">
        <span>{PHASE_LABELS[clock.phase]}</span>
        {clock.remainingMs === null ? null : (
          <strong>{clockText(clock.remainingMs)}</strong>
        )}
        {clock.paused ? <em>pausado</em> : null}
      </div>
      <div className="admin-bar-numbers">
        <span>
          <strong>{people.joined}</strong> entraram
        </span>
        <span>
          <strong>{people.connected}</strong> conectadas
        </span>
        <span>
          <strong>{people.simulated}</strong> simuladas
        </span>
        <span data-alert={spending?.exceeded === true}>
          {spending
            ? `${dollars.format(spending.spentUsd)} de ${dollars.format(spending.ceilingUsd)}`
            : "gasto: sem estimativa"}
        </span>
      </div>
      {connection === "live" ? null : (
        <span className="admin-offline">reconectando…</span>
      )}
    </header>
  );
}

function PhaseControls({ clock, act }: { act: Act; clock: PhaseStatus }) {
  const next = nextPhase(clock.phase);
  return (
    <section className="admin-card">
      <h2>Fase</h2>
      <div className="admin-main-buttons">
        {clock.phase === "entrada" ? (
          <button
            className="admin-primary"
            onClick={() => act("iniciar")}
            type="button"
          >
            Iniciar: {PHASE_LABELS.formar}
          </button>
        ) : (
          <button
            className="admin-primary"
            disabled={next === null}
            onClick={() => act("avancar")}
            type="button"
          >
            {next ? `Avançar para ${PHASE_LABELS[next]}` : "Última fase"}
          </button>
        )}
        {clock.paused ? (
          <button onClick={() => act("retomar")} type="button">
            Retomar
          </button>
        ) : (
          <button onClick={() => act("pausar")} type="button">
            Pausar
          </button>
        )}
      </div>
    </section>
  );
}

function Durations({ clock, act }: { act: Act; clock: PhaseStatus }) {
  return (
    <section className="admin-card">
      <h2>Duração das fases</h2>
      <ul className="admin-durations">
        {TIMED.map((phase) => {
          const value = clock.durations[phase];
          return (
            <li data-current={clock.phase === phase} key={phase}>
              <span>{PHASE_LABELS[phase]}</span>
              <button
                aria-label={`Menos 30 segundos em ${PHASE_LABELS[phase]}`}
                disabled={value <= MIN_MS}
                onClick={() =>
                  act("duracoes", {
                    [phase]: Math.max(MIN_MS, value - STEP_MS),
                  })
                }
                type="button"
              >
                −
              </button>
              <strong>{clockText(value)}</strong>
              <button
                aria-label={`Mais 30 segundos em ${PHASE_LABELS[phase]}`}
                onClick={() => act("duracoes", { [phase]: value + STEP_MS })}
                type="button"
              >
                +
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Simulated({ state, act }: { act: Act; state: AdminState }) {
  const [total, setTotal] = useState(DEFAULT_SIMULATED);
  return (
    <section className="admin-card">
      <h2>Bonecos simulados</h2>
      <p className="admin-hint">
        Pessoas de mentira que respondem e votam sozinhas. Os bonecos delas
        pensam com os modelos da sala.
      </p>
      <label className="admin-total">
        Preencher a praça até
        <input
          inputMode="numeric"
          max={60}
          min={1}
          onChange={(event) => setTotal(Number(event.target.value) || 0)}
          type="number"
          value={total}
        />
        bonecos
      </label>
      <div className="admin-main-buttons">
        <button onClick={() => act("simulados", { total })} type="button">
          Preencher
        </button>
        <button
          disabled={state.people.simulated === 0}
          onClick={() => act("simulados/remover")}
          type="button"
        >
          Remover simulados ({state.people.simulated})
        </button>
      </div>
    </section>
  );
}

function BonecoRow({ boneco, act }: { act: Act; boneco: AdminBoneco }) {
  return (
    <li className="admin-boneco">
      <div>
        <strong>{boneco.name}</strong>
        <small>
          {[
            boneco.simulated ? "simulado" : null,
            boneco.connected ? "conectado" : null,
            boneco.silenced ? "silenciado" : null,
            boneco.model,
          ]
            .filter(Boolean)
            .join(" · ")}
        </small>
      </div>
      <button
        onClick={() =>
          act("silenciar", { boneco: boneco.id, silenciado: !boneco.silenced })
        }
        type="button"
      >
        {boneco.silenced ? "Liberar fala" : "Silenciar"}
      </button>
      <ConfirmButton
        confirmLabel="Expulsar"
        label="Expulsar…"
        onConfirm={() => act("expulsar", { boneco: boneco.id })}
      />
    </li>
  );
}

function Bonecos({ state, act }: { act: Act; state: AdminState }) {
  const [showSimulated, setShowSimulated] = useState(false);
  const shown = state.bonecos.filter(
    (boneco) => showSimulated || !boneco.simulated
  );
  return (
    <section className="admin-card">
      <h2>Bonecos na praça ({state.bonecos.length})</h2>
      {state.people.simulated > 0 ? (
        <label className="admin-check">
          <input
            checked={showSimulated}
            onChange={(event) => setShowSimulated(event.target.checked)}
            type="checkbox"
          />
          Mostrar os simulados
        </label>
      ) : null}
      {shown.length === 0 ? (
        <p className="admin-hint">Ninguém por aqui ainda.</p>
      ) : (
        <ul className="admin-bonecos">
          {shown.map((boneco) => (
            <BonecoRow act={act} boneco={boneco} key={boneco.id} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminPage() {
  const secret = adminSecret();
  if (!secret) {
    return (
      <main className="admin admin-message">
        <h1>Admin do bloco</h1>
        <p>Abra o link do admin que o servidor imprime ao subir.</p>
      </main>
    );
  }
  return <AdminScreen secret={secret} />;
}

function AdminScreen({ secret }: { secret: string }) {
  const { state, connection, error, act } = useAdmin(secret);
  if (connection === "denied") {
    return (
      <main className="admin admin-message">
        <h1>Admin do bloco</h1>
        <p>Este link não tem o segredo certo.</p>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="admin admin-message">
        <h1>Admin do bloco</h1>
        <p>Conectando…</p>
      </main>
    );
  }
  return (
    <main className="admin">
      <StatusBar connection={connection} state={state} />
      {error ? (
        <p className="admin-error" role="alert">
          {error}
        </p>
      ) : null}
      <PhaseControls act={act} clock={state.clock} />
      <Durations act={act} clock={state.clock} />
      <Simulated act={act} state={state} />
      <Bonecos act={act} state={state} />
      <AdminModelsSection secret={secret} />
      <section className="admin-card admin-restart">
        <h2>Recomeçar</h2>
        <p className="admin-hint">
          Volta para a entrada e tira todos os bonecos. As durações ficam.
        </p>
        <ConfirmButton
          className="admin-danger"
          confirmLabel="Sim, reiniciar do zero"
          label="Reiniciar do zero…"
          onConfirm={() => act("reiniciar")}
        />
      </section>
      <p className="admin-hint">
        Veja a praça no <a href="/telao">telão</a>.
      </p>
    </main>
  );
}
