// A boneco asking its human something, with a countdown. The human answers
// from the phone; when the time runs out the boneco decides alone and says
// so. The interview uses it, and so will confirming a bloco and voting: each
// use is a `purpose`, and the world hands the outcome to that purpose.

export interface Ask {
  /** Typing in an open question pushes the deadline to at most this. */
  capMs: number;
  deadlineMs: number;
  id: string;
  /** Who wrote the question, as shown to people; null when it is a fixed one. */
  model: string | null;
  openedAtMs: number;
  /** Two or three choices; empty for an open question. */
  options: string[];
  /** Who gets the outcome, for example "interview". */
  purpose: string;
  question: string;
  /** Free text up to this length is accepted; null means choices only. */
  textMaxLength: number | null;
}

export interface AskOutcome {
  askId: string;
  /** "boneco" when the time ran out and the boneco decided alone. */
  by: "boneco" | "human";
  /** Index into the options, or null when nothing was chosen. */
  choice: number | null;
  purpose: string;
  /** Free text the human wrote. It goes to the model and nowhere else. */
  text: string | null;
}

/** What a phone sends for the question it shows. */
export interface HumanAnswer {
  askId: string;
  choice?: number;
  /** The human skipped an open question. */
  skip?: boolean;
  text?: string;
  /** The human is typing: the boneco waits a little longer. */
  typing?: boolean;
}

export interface AskSpec {
  model?: string | null;
  options: string[];
  purpose: string;
  question: string;
  textMaxLength?: number | null;
}

export interface AskTiming {
  /** Countdown of every question. */
  askMs: number;
  /** An open question never waits longer than this in total. */
  askTypingCapMs: number;
}

export function openAsk(
  spec: AskSpec,
  id: string,
  nowMs: number,
  timing: AskTiming
): Ask {
  return {
    id,
    purpose: spec.purpose,
    question: spec.question,
    options: spec.options,
    textMaxLength: spec.textMaxLength ?? null,
    model: spec.model ?? null,
    openedAtMs: nowMs,
    deadlineMs: nowMs + timing.askMs,
    capMs: nowMs + Math.max(timing.askMs, timing.askTypingCapMs),
  };
}

export type AnswerResult =
  | { outcome: AskOutcome }
  | { ask: Ask }
  | { error: string };

/** A human answer to an open ask: the outcome, a longer wait, or why not. */
export function answerAsk(
  ask: Ask,
  answer: HumanAnswer,
  nowMs: number,
  timing: AskTiming
): AnswerResult {
  if (answer.askId !== ask.id) {
    return { error: "esta pergunta já passou" };
  }
  const outcome = (choice: number | null, text: string | null): AskOutcome => ({
    askId: ask.id,
    purpose: ask.purpose,
    by: "human",
    choice,
    text,
  });
  if (answer.typing) {
    if (ask.textMaxLength === null) {
      return { error: "esta pergunta não aceita texto" };
    }
    return {
      ask: {
        ...ask,
        deadlineMs: Math.min(
          ask.capMs,
          Math.max(ask.deadlineMs, nowMs + timing.askMs)
        ),
      },
    };
  }
  if (answer.skip) {
    return { outcome: outcome(null, null) };
  }
  if (typeof answer.text === "string") {
    if (ask.textMaxLength === null) {
      return { error: "esta pergunta não aceita texto" };
    }
    const text = answer.text.trim().slice(0, ask.textMaxLength);
    return { outcome: outcome(null, text || null) };
  }
  if (
    Number.isInteger(answer.choice) &&
    (answer.choice as number) >= 0 &&
    (answer.choice as number) < ask.options.length
  ) {
    return { outcome: outcome(answer.choice as number, null) };
  }
  return { error: "resposta inválida" };
}

/** The boneco's own choice when the time ran out; `roll` is in [0, 1). */
export function decideAlone(ask: Ask, roll: number): AskOutcome {
  return {
    askId: ask.id,
    purpose: ask.purpose,
    by: "boneco",
    choice:
      ask.options.length > 0 ? Math.floor(roll * ask.options.length) : null,
    text: null,
  };
}

/** What the boneco tells its human when it decided alone. */
export function decidedAloneNotice(ask: Ask, outcome: AskOutcome): string {
  if (outcome.choice === null) {
    return "O tempo acabou. Tudo bem, sigo sem essa resposta.";
  }
  return `O tempo acabou, então escolhi sozinho: ${ask.options[outcome.choice]}.`;
}
