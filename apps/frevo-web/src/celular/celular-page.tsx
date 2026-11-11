// The phone: the person's boneco, the model that thinks for it, its recent
// thoughts and one question at a time with a countdown.

import { modelLabel } from "@gambiarra-lab/frevo/models";
import type { Talk, Thought } from "@gambiarra-lab/frevo/snapshot";
import type { PhoneView as PrivateView } from "@gambiarra-lab/frevo/views";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { BonecoSprite } from "../art/boneco-sprite";
import { phaseLine } from "../phase/phase-text";
import { blocoColor, blocoLabel } from "../telao/bloco-mark";
import { ComporPanel } from "./compor-panel";
import { otherModelLine, ownModelLabel } from "./model-line";
import { type Reply, useCelular } from "./use-celular";

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

/** The bloco's refrain in the desfile, and in the final whether it was chosen. */
function DesfileResult({
  desfile,
  mark,
}: {
  desfile: NonNullable<PrivateView["desfile"]>;
  mark: number;
}) {
  let line = desfile.onStage
    ? "Seu bloco está desfilando no telão agora!"
    : "Seu bloco desfila no telão.";
  if (desfile.chosen) {
    line = "Seu bloco foi escolhido pelo júri!";
  } else if (desfile.phase === "final") {
    line = "O desfile acabou. Seu bloco não foi escolhido desta vez.";
  }
  return (
    <section
      aria-live="polite"
      className="celular-desfile"
      data-chosen={desfile.chosen}
      style={{ "--bloco": blocoColor(mark) } as React.CSSProperties}
    >
      <p className="celular-desfile-line">{line}</p>
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
      <span className="celular-countdown-text">
        {countdownText(seconds, vote)}
      </span>
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
  reply: (askId: string, answer: Reply) => Promise<boolean>;
  vote: boolean;
}) {
  const [sent, setSent] = useState(false);
  const [text, setText] = useState("");
  const lastPing = useRef(0);

  function send(answer: Reply) {
    setSent(true);
    reply(ask.id, answer).then((ok) => {
      if (!ok) {
        setSent(false);
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
    <section aria-live="polite" className="celular-question">
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
      <Countdown remainingMs={remainingMs} totalMs={ask.totalMs} vote={vote} />
    </section>
  );
}

/** Whom the boneco talked to in the square, and what each one said. */
function Talks({ talks }: { talks: Talk[] }) {
  if (talks.length === 0) {
    return null;
  }
  return (
    <section className="celular-talks">
      <h2>Com quem ele conversou</h2>
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
    </section>
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
    <section className="celular-thoughts">
      <h2>O que ele anda pensando</h2>
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
    </section>
  );
}

function Status({ view }: { view: PrivateView }) {
  const { boneco, interview } = view;
  if (interview && !interview.done) {
    return (
      <p className="celular-progress">
        {interview.answered < interview.total
          ? `Pergunta ${Math.min(interview.answered + 1, interview.total)} de ${interview.total}`
          : "Última: uma pergunta aberta"}
        {boneco.thinking ? " · pensando…" : ""}
      </p>
    );
  }
  return null;
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
  const { view, status, reply, receivedAt, expelled, full } = useCelular();
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
      <p className="celular-progress">{phaseLine(view.clock)}</p>
      <Status view={view} />
      {ask ? (
        <Question
          ask={ask}
          key={ask.id}
          remainingMs={remainingMs}
          reply={reply}
          vote={view.compor?.voting === true}
        />
      ) : null}
      {!ask && boneco.thinking && !boneco.personality ? (
        <p className="celular-thinking">Pensando na próxima pergunta…</p>
      ) : null}
      {view.compor ? <ComporPanel compor={view.compor} /> : null}
      {view.desfile && view.bloco ? (
        <DesfileResult desfile={view.desfile} mark={view.bloco.mark} />
      ) : null}
      {view.bloco ? <BlocoMates bloco={view.bloco} /> : null}
      <Personality boneco={boneco} />
      <Talks talks={view.talks} />
      <ThoughtList thoughts={view.thoughts} />
      <p className="celular-footer">
        Seu boneco aparece no telão. Ele decide sozinho quando você não
        responde.
      </p>
    </main>
  );
}
