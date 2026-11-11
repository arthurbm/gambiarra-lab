// The interview a boneco does with its human on arrival: three tap questions
// the model writes, one optional open question, then a two-line personality
// and an instrument. The world drives the steps; this module keeps what the
// interview knows and the fixed texts it falls back to.
import { filterModelText } from "./blocklist";

export const TAP_QUESTIONS = 3;
export const OPEN_TEXT_MAX_LENGTH = 80;
export const OPEN_QUESTION =
  "Me conta uma coisa sua, em poucas palavras. Se preferir, pode pular.";

export const INSTRUMENTS = [
  "trompete",
  "trombone",
  "saxofone",
  "tuba",
  "surdo",
  "caixa",
  "pandeiro",
  "sombrinha",
] as const;
export type Instrument = (typeof INSTRUMENTS)[number];

const QUESTION_MAX_LENGTH = 90;
const OPTION_MAX_LENGTH = 40;
const SUMMARY_LINE_MAX_LENGTH = 90;
const LINE_BREAK = /\r?\n/;

export interface InterviewAnswer {
  answer: string;
  by: "boneco" | "human";
  question: string;
}

export interface Interview {
  answers: InterviewAnswer[];
  /** What the human wrote in the open question. Only the model ever sees it. */
  freeText: string | null;
  /** Fixed questions already used, so they do not repeat. */
  reservesUsed: number[];
  stage: "done" | "open" | "personality" | "tap";
}

/** Questions used when the model does not write one in time. */
export const RESERVE_QUESTIONS: { options: string[]; question: string }[] = [
  {
    question: "Pra começar o dia no Recife, qual é a tua?",
    options: ["Cuscuz com ovo", "Tapioca de coco", "Só um cafezinho"],
  },
  {
    question: "No carnaval, tu é de qual turma?",
    options: ["Frevo no pé", "Maracatu de baque virado", "Vejo da calçada"],
  },
  {
    question: "Onde tu passaria um domingo?",
    options: ["Praia de Boa Viagem", "Rua do Bom Jesus", "Em casa, na rede"],
  },
  {
    question: "Que som tu bota pra animar?",
    options: ["Frevo de Capiba", "Manguebeat", "Brega romântico"],
  },
  {
    question: "Na ladeira de Olinda, tu…",
    options: ["Sobe dançando", "Sobe devagar", "Espera lá embaixo"],
  },
  {
    question: "Tá chovendo no Recife. E aí?",
    options: ["Bolo de rolo e café", "Saio assim mesmo", "Durmo mais um pouco"],
  },
];

export function startInterview(): Interview {
  return { stage: "tap", answers: [], freeText: null, reservesUsed: [] };
}

/** A fixed question not used yet; `roll` is in [0, 1). */
export function reserveQuestion(
  interview: Interview,
  roll: number
): { interview: Interview; options: string[]; question: string } {
  const all = RESERVE_QUESTIONS.map((_, position) => position);
  const unused = all.filter(
    (position) => !interview.reservesUsed.includes(position)
  );
  const pool = unused.length > 0 ? unused : all;
  const index = pool[Math.floor(roll * pool.length)] as number;
  const reserve = RESERVE_QUESTIONS[index] as (typeof RESERVE_QUESTIONS)[0];
  return {
    interview: {
      ...interview,
      reservesUsed: [...interview.reservesUsed, index],
    },
    question: reserve.question,
    options: reserve.options,
  };
}

/** A question the model wrote, filtered, or null when it cannot be used. */
export function acceptQuestion(
  question: unknown,
  options: unknown
): { options: string[]; question: string } | null {
  const text = filterModelText(question, QUESTION_MAX_LENGTH);
  if (!(text && Array.isArray(options))) {
    return null;
  }
  const clean = options.map((option) =>
    filterModelText(option, OPTION_MAX_LENGTH)
  );
  const distinct = new Set(clean.map((option) => option?.toLowerCase()));
  if (
    clean.length < 2 ||
    clean.length > 3 ||
    clean.some((option) => option === null) ||
    distinct.size !== clean.length
  ) {
    return null;
  }
  return { question: text, options: clean as string[] };
}

/** The interview after a tap question was answered, by the human or not. */
export function recordTap(
  interview: Interview,
  answer: InterviewAnswer
): Interview {
  const answers = [...interview.answers, answer];
  return {
    ...interview,
    answers,
    stage: answers.length >= TAP_QUESTIONS ? "open" : "tap",
  };
}

export function recordOpen(
  interview: Interview,
  text: string | null
): Interview {
  return { ...interview, freeText: text, stage: "personality" };
}

/** A personality the model wrote: two filtered lines, or null. */
export function acceptPersonality(summary: unknown): string[] | null {
  if (typeof summary !== "string") {
    return null;
  }
  const lines = summary
    .split(LINE_BREAK)
    .filter((line) => line.trim())
    .slice(0, 2)
    .map((line) => filterModelText(line, SUMMARY_LINE_MAX_LENGTH));
  // A blocked line drops the whole summary, so nothing is half shown.
  if (lines.length === 0 || lines.some((line) => line === null)) {
    return null;
  }
  return lines as string[];
}

export function isInstrument(value: unknown): value is Instrument {
  return INSTRUMENTS.includes(value as Instrument);
}

/** A personality from the answers alone, when the model did not write one. */
export function fallbackPersonality(interview: Interview): string[] {
  const picks = interview.answers.map((answer) => answer.answer.toLowerCase());
  const [first, second, third] = picks;
  if (!first) {
    return ["Chegou na praça no passo do frevo.", "Gosta de uma boa surpresa."];
  }
  return [
    second ? `Gosta de ${first} e de ${second}.` : `Gosta de ${first}.`,
    third
      ? `Na dúvida, vai de ${third}.`
      : "Chegou na praça no passo do frevo.",
  ];
}
