// The phone. A first visit asks the person's name and lets them pick their
// boneco among the thirty (or have one drawn). After that, top to bottom:
// the boneco, the row of phases, then one "now" card that says what is
// happening and where to look, with the question inside when it is the
// person's turn. Everything else (bloco, personality, talks, thoughts) comes
// below, quieter, and the long lists start folded. At the very bottom, a quiet
// "Sair da praça" asks once more before the boneco goes.

import { modelLabel } from "@gambiarra-lab/frevo/models";
import {
  LOOKS,
  PERSON_NAME_MAX_LENGTH,
  type Talk,
  type Thought,
} from "@gambiarra-lab/frevo/snapshot";
import type { PhoneView as PrivateView } from "@gambiarra-lab/frevo/views";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { BonecoSprite } from "../art/boneco-sprite";
import { CHARACTERS } from "../art/characters";
import { PhaseSteps } from "../phase/phase-steps";
import { PHASE_ORDER, phaseLine } from "../phase/phase-text";
import { blocoColor, blocoLabel } from "../telao/bloco-mark";
import { ComporPanel } from "./compor-panel";
import { otherModelLine, ownModelLabel } from "./model-line";
import { LOOK_LABEL, nowCard } from "./now-text";
import { type Replied, type Reply, useCelular } from "./use-celular";

const TYPING_PING_MS = 4000;

/** Re-renders every `ms`, for the countdown. */
function useTick(ms: number) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((tick) => tick + 1), ms);
    return () => clearInterval(timer);
  }, [ms]);
}

function BonecoPortrait({
  boneco,
  scale = 3,
}: {
  boneco: { instrument?: string | null; look: number; name: string };
  scale?: number;
}) {
  return (
    <span className="celular-boneco">
      <BonecoSprite
        instrument={boneco.instrument}
        look={boneco.look}
        scale={scale}
      />
    </span>
  );
}

/** The bloco's name and refrain in the desfile and the final; the "now" card says how it went. */
function DesfileResult({
  desfile,
  mark,
}: {
  desfile: NonNullable<PrivateView["desfile"]>;
  mark: number;
}) {
  return (
    <section
      className="celular-desfile"
      data-chosen={desfile.chosen}
      style={{ "--bloco": blocoColor(mark) } as React.CSSProperties}
    >
      <h2>{desfile.name}</h2>
      <blockquote>
        {desfile.refrain.map((verse, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a refrain may repeat a line.
          <p key={index}>{verse}</p>
        ))}
      </blockquote>
    </section>
  );
}

function Countdown({
  remainingMs,
  totalMs,
  vote,
}: {
  remainingMs: number;
  totalMs: number;
  vote: boolean;
}) {
  const seconds = Math.ceil(remainingMs / 1000);
  const share = Math.max(0, Math.min(1, remainingMs / totalMs));
  return (
    <div className="celular-countdown">
      <div className="celular-countdown-bar">
        <span style={{ width: `${share * 100}%` }} />
      </div>
      <span>{countdownText(seconds, vote)}</span>
    </div>
  );
}

function countdownText(seconds: number, vote: boolean): string {
  if (vote) {
    return seconds > 0
      ? `${seconds} s para votar. Depois vale o voto de quem votou.`
      : "Fechando a votação…";
  }
  return seconds > 0
    ? `${seconds} s para responder. Depois eu decido sozinho.`
    : "Decidindo sozinho…";
}

function Question({
  ask,
  remainingMs,
  reply,
  vote,
}: {
  ask: NonNullable<PrivateView["ask"]>;
  remainingMs: number;
  reply: (askId: string, answer: Reply) => Promise<Replied>;
  vote: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const lastPing = useRef(0);
  const writeId = useId();
  /** A vote that also takes a written option: the bloco's name. */
  const canWrite = ask.options.length > 0 && ask.textMaxLength !== null;

  function send(answer: Reply) {
    setSent(true);
    setProblem(null);
    reply(ask.id, answer).then((replied) => {
      if (!replied.ok) {
        setSent(false);
        setProblem(replied.erro ?? null);
      }
    });
  }

  function typed(value: string) {
    setText(value);
    const now = Date.now();
    if (now - lastPing.current > TYPING_PING_MS) {
      lastPing.current = now;
      reply(ask.id, { digitando: true });
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    send(text.trim() ? { texto: text } : { pular: true });
  }

  return (
    <div className="celular-question">
      <p className="celular-question-text">{ask.question}</p>
      {ask.options.length > 0 ? (
        <div className="celular-options">
          {ask.options.map((option, index) => (
            <button
              className={vote ? "celular-vote-option" : undefined}
              disabled={sent}
              key={option}
              onClick={() => send({ opcao: index })}
              type="button"
            >
              {option}
            </button>
          ))}
        </div>
      ) : (
        <form className="celular-open" onSubmit={submit}>
          <textarea
            aria-label="Sua resposta"
            disabled={sent}
            maxLength={ask.textMaxLength ?? 80}
            onChange={(event) => typed(event.target.value)}
            placeholder="Escreva aqui, se quiser"
            rows={2}
            value={text}
          />
          <span className="celular-open-count">
            {text.length}/{ask.textMaxLength ?? 80}
          </span>
          <div className="celular-open-actions">
            <button disabled={sent || !text.trim()} type="submit">
              Enviar
            </button>
            <button
              className="celular-skip"
              disabled={sent}
              onClick={() => send({ pular: true })}
              type="button"
            >
              Pular
            </button>
          </div>
        </form>
      )}
      {canWrite ? (
        <form className="celular-write" onSubmit={submit}>
          <label htmlFor={writeId}>Nenhum desses? Escreva outro nome:</label>
          <div className="celular-write-row">
            <input
              disabled={sent}
              enterKeyHint="send"
              id={writeId}
              maxLength={ask.textMaxLength ?? undefined}
              onChange={(event) => typed(event.target.value)}
              placeholder="Bloco do…"
              type="text"
              value={text}
            />
            <button disabled={sent || !text.trim()} type="submit">
              Propor
            </button>
          </div>
        </form>
      ) : null}
      {problem ? (
        <p className="celular-question-problem" role="alert">
          {problem}
        </p>
      ) : null}
      <Countdown remainingMs={remainingMs} totalMs={ask.totalMs} vote={vote} />
    </div>
  );
}

/** Whom the boneco talked to in the square, and what each one said. */
function Talks({ talks }: { talks: Talk[] }) {
  if (talks.length === 0) {
    return null;
  }
  return (
    <details className="celular-fold celular-talks">
      <summary>Com quem ele conversou ({talks.length})</summary>
      <ol>
        {[...talks].reverse().map((talk) => (
          <li key={`${talk.atMs}-${talk.with.id}`}>
            <strong>{talk.with.name}</strong>
            <p>Ele: {talk.mine ?? "(ficou calado)"}</p>
            <p>
              {talk.with.name}: {talk.theirs ?? "(ficou calado)"}
            </p>
            {talk.liked === null ? null : (
              <small>
                {talk.liked
                  ? "Achou que vocês combinam."
                  : "Achou que não combinam muito."}
              </small>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The other people in the boneco's bloco, with name and boneco. */
function BlocoMates({ bloco }: { bloco: NonNullable<PrivateView["bloco"]> }) {
  return (
    <section
      className="celular-bloco"
      style={{ "--bloco": blocoColor(bloco.mark) } as React.CSSProperties}
    >
      <h2>Seu bloco: {blocoLabel(bloco.mark)}</h2>
      {bloco.mates.length === 0 ? (
        <p>Por enquanto só você. Já chega mais gente.</p>
      ) : (
        <ul>
          {bloco.mates.map((mate) => (
            <li key={mate.id}>
              <BonecoPortrait boneco={mate} />
              <span>
                <strong>{mate.name}</strong>
                {mate.instrument ? ` · ${mate.instrument}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ThoughtList({ thoughts }: { thoughts: Thought[] }) {
  if (thoughts.length === 0) {
    return null;
  }
  return (
    <details className="celular-fold celular-thoughts">
      <summary>O que ele anda pensando ({thoughts.length})</summary>
      <ol>
        {[...thoughts].reverse().map((thought) => (
          <li data-tone={thought.tone} key={`${thought.atMs}-${thought.text}`}>
            <p>{thought.text}</p>
            {thought.model ? (
              <small>pensado por {modelLabel(thought.model)}</small>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** The looks already on the square, asked once when the welcome opens. */
function useLooksInUse(): Set<number> {
  const [inUse, setInUse] = useState<Set<number>>(() => new Set());
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/visuais", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { emUso?: unknown } | null) => {
        if (Array.isArray(body?.emUso)) {
          setInUse(
            new Set(body.emUso.filter((look) => typeof look === "number"))
          );
        }
      })
      // Without the list every boneco looks free; the server still refuses a taken one.
      .catch(() => undefined);
    return () => controller.abort();
  }, []);
  return inUse;
}

/**
 * The thirty bonecos to pick from, plus letting one be drawn. Those already
 * on the square are greyed out: the world does not repeat a look.
 */
function LookPicker({
  busy,
  error,
  look,
  setLook,
}: {
  busy: boolean;
  error: string | null;
  look: number | null;
  setLook: (look: number | null) => void;
}) {
  const inUse = useLooksInUse();
  // A pick someone else took meanwhile goes back to a drawn one.
  useEffect(() => {
    if (look !== null && inUse.has(look)) {
      setLook(null);
    }
  }, [inUse, look, setLook]);
  return (
    <fieldset className="celular-looks" disabled={busy}>
      <legend>Escolha seu boneco</legend>
      <button
        aria-pressed={look === null}
        className="celular-look-draw"
        onClick={() => setLook(null)}
        type="button"
      >
        Sortear um boneco para mim
      </button>
      <div className="celular-looks-grid">
        {Array.from({ length: LOOKS }, (_, index) => {
          const taken = inUse.has(index);
          return (
            <button
              aria-label={`Boneco ${index + 1}${taken ? ", já está na praça" : ""}`}
              aria-pressed={look === index}
              className="celular-look"
              disabled={taken}
              key={CHARACTERS[index]}
              onClick={() => setLook(index)}
              type="button"
            >
              <BonecoSprite look={index} scale={2} />
            </button>
          );
        })}
      </div>
      <p aria-live="polite" className="celular-looks-note">
        {look === null
          ? "Seu boneco vai ser sorteado."
          : `Você escolheu o boneco ${look + 1}.`}
        {inUse.size > 0 ? " Os apagados já estão na praça." : ""}
      </p>
      {error ? (
        <p className="celular-question-problem" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** A first visit: the person says how they want to be called on the telão. */
function Welcome({
  error,
  initialLook,
  initialName,
  lookError,
  start,
}: {
  error: string | null;
  /** The boneco picked before leaving, if any. */
  initialLook: number | null;
  /** The name typed before leaving, if any. */
  initialName: string | null;
  lookError: string | null;
  start: (name: string | null, look: number | null) => Promise<void> | null;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [look, setLook] = useState<number | null>(initialLook);
  const [busy, setBusy] = useState(false);
  const nameId = useId();

  function enter(chosen: string | null) {
    setBusy(true);
    Promise.resolve(start(chosen, look)).finally(() => setBusy(false));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    enter(name.trim() || null);
  }

  return (
    <main className="celular celular-welcome">
      <h1>Bloco de frevo</h1>
      <p className="celular-welcome-lead">
        Você ganha um boneco que pensa com uma IA. Ele entra na praça do telão,
        acha um bloco para você e compõe um frevo.
      </p>
      <form className="celular-welcome-form" onSubmit={submit}>
        <label htmlFor={nameId}>Como você quer aparecer no telão?</label>
        <input
          autoCapitalize="words"
          autoComplete="given-name"
          disabled={busy}
          enterKeyHint="go"
          id={nameId}
          maxLength={PERSON_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          placeholder="Seu nome ou apelido"
          type="text"
          value={name}
        />
        {error ? (
          <p className="celular-question-problem" role="alert">
            {error}
          </p>
        ) : null}
        <LookPicker
          busy={busy}
          error={lookError}
          look={look}
          setLook={setLook}
        />
        <button disabled={busy || !name.trim()} type="submit">
          Entrar na praça
        </button>
        <button
          className="celular-skip"
          disabled={busy}
          onClick={() => enter(null)}
          type="button"
        >
          Prefiro um nome sorteado
        </button>
      </form>
      <p className="celular-footer">Sem cadastro. Leva menos de um minuto.</p>
    </main>
  );
}

/** What is happening now and where to look, with the question when there is one. */
function Now({
  remainingMs,
  reply,
  view,
}: {
  remainingMs: number;
  reply: (askId: string, answer: Reply) => Promise<Replied>;
  view: PrivateView;
}) {
  const card = nowCard(view);
  return (
    <section aria-live="polite" className="celular-now" data-look={card.look}>
      <p className="celular-now-look">{LOOK_LABEL[card.look]}</p>
      <h2 className="celular-now-title">{card.title}</h2>
      <p className="celular-now-text">{card.text}</p>
      {view.ask ? (
        <Question
          ask={view.ask}
          key={view.ask.id}
          remainingMs={remainingMs}
          reply={reply}
          vote={view.ask.purpose === "voto"}
        />
      ) : null}
    </section>
  );
}

/** Leaving the square, at the bottom: one tap asks, the second one leaves. */
function Leave({ leave }: { leave: () => Promise<Replied> }) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  function confirm() {
    setBusy(true);
    setProblem(null);
    leave().then((left) => {
      if (!left.ok) {
        setBusy(false);
        setProblem(left.erro ?? null);
      }
    });
  }

  if (!armed) {
    return (
      <div className="celular-leave">
        <button
          className="celular-leave-open"
          onClick={() => setArmed(true)}
          type="button"
        >
          Sair da praça
        </button>
      </div>
    );
  }
  return (
    <div className="celular-leave">
      <p className="celular-leave-question">
        Sair da praça? Seu boneco vai embora.
      </p>
      <div className="celular-leave-actions">
        <button
          className="celular-leave-confirm"
          disabled={busy}
          onClick={confirm}
          type="button"
        >
          Sair
        </button>
        <button
          className="celular-skip"
          disabled={busy}
          onClick={() => {
            setArmed(false);
            setProblem(null);
          }}
          type="button"
        >
          Cancelar
        </button>
      </div>
      {problem ? (
        <p className="celular-question-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </div>
  );
}

function Personality({ boneco }: { boneco: PrivateView["boneco"] }) {
  if (!boneco.personality) {
    return null;
  }
  return (
    <section className="celular-personality">
      <h2>Como ele te vê</h2>
      {boneco.personality.map((line) => (
        <p key={line}>{line}</p>
      ))}
      {boneco.instrument ? (
        <p className="celular-instrument">
          Figurino: <strong>{boneco.instrument}</strong>
        </p>
      ) : null}
    </section>
  );
}

export function CelularPage() {
  const {
    view,
    status,
    reply,
    receivedAt,
    expelled,
    full,
    welcome,
    nameError,
    start,
    leave,
    lastName,
    lastLook,
    lookError,
  } = useCelular();
  useTick(250);

  if (expelled) {
    return (
      <main className="celular celular-waiting">
        <h1>Bloco de frevo</h1>
        <p>O host tirou seu boneco da praça.</p>
      </main>
    );
  }

  if (full && !view) {
    return (
      <main className="celular celular-waiting">
        <h1>Bloco de frevo</h1>
        <p>A praça lotou. Acompanhe pelo telão.</p>
      </main>
    );
  }

  if (welcome && !view) {
    return (
      <Welcome
        error={nameError}
        initialLook={lastLook}
        initialName={lastName}
        // A boneco taken meanwhile opens the welcome afresh: the name is
        // kept and the list of bonecos in use is asked again.
        key={lookError ?? ""}
        lookError={lookError}
        start={start}
      />
    );
  }

  if (!view) {
    return (
      <main className="celular celular-waiting">
        <h1>Bloco de frevo</h1>
        <p>Chamando seu boneco…</p>
      </main>
    );
  }

  const { boneco, ask } = view;
  const remainingMs = ask
    ? Math.max(0, ask.remainingMs - (Date.now() - receivedAt.current))
    : 0;

  return (
    <main className="celular">
      <header className="celular-header">
        <BonecoPortrait boneco={boneco} scale={4} />
        <div>
          <h1>{boneco.name}</h1>
          <p className="celular-model">
            Quem pensa por mim:{" "}
            <strong>{ownModelLabel(boneco) ?? "esperando um modelo…"}</strong>
          </p>
          {otherModelLine(boneco) ? (
            <p className="celular-model-other">{otherModelLine(boneco)}</p>
          ) : null}
        </div>
        {status === "live" ? null : (
          <span className="celular-offline">reconectando…</span>
        )}
      </header>
      <nav aria-label="Etapas da brincadeira" className="celular-steps">
        <PhaseSteps phase={view.clock.phase} />
        <p className="celular-steps-line">
          Etapa {PHASE_ORDER.indexOf(view.clock.phase) + 1} de{" "}
          {PHASE_ORDER.length} · {phaseLine(view.clock)}
        </p>
      </nav>
      <Now remainingMs={remainingMs} reply={reply} view={view} />
      {view.desfile && view.bloco ? (
        <DesfileResult desfile={view.desfile} mark={view.bloco.mark} />
      ) : null}
      {view.compor && !view.desfile ? (
        <ComporPanel asking={ask?.purpose === "voto"} compor={view.compor} />
      ) : null}
      {view.bloco ? <BlocoMates bloco={view.bloco} /> : null}
      <Personality boneco={boneco} />
      <Talks talks={view.talks} />
      <ThoughtList thoughts={view.thoughts} />
      <p className="celular-footer">
        Seu boneco aparece no telão. Ele decide sozinho quando você não
        responde.
      </p>
      <Leave leave={leave} />
    </main>
  );
}
