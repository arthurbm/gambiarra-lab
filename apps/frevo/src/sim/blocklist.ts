// The one filter every piece of model text goes through before it enters the
// world, and so before it can reach the telão or a phone. The square is a
// public event: a line with a blocked word, or with letters from another
// script (some models leak Chinese or Japanese mid-sentence), is dropped.

/** Whole words, compared without accents and case. */
const BLOCKED_WORDS = new Set([
  "bct",
  "bosta",
  "bucetas",
  "cacete",
  "corno",
  "cu",
  "cuzao",
  "fdp",
  "kct",
  "nazi",
  "nazista",
  "pqp",
  "puta",
  "putas",
  "vsf",
  "xota",
  "xoxota",
  "fuck",
  "shit",
  "bitch",
  "hitler",
]);

/** Word beginnings: every word that starts like this is blocked. */
const BLOCKED_ROOTS = [
  "arrombad",
  "babac",
  "boquet",
  "bucet",
  "caralh",
  "escrot",
  "estupr",
  "fod",
  "fuck",
  "imbecil",
  "merd",
  "otari",
  "piroc",
  "porr",
  "punhet",
  "putari",
  "retardad",
  "vadi",
  "viad",
  "sapatao",
  "traveco",
];

const ACCENTS = /\p{M}+/gu;
const NOT_LETTERS = /[^\p{L}\p{N}]+/u;
const SPACES = /\s+/g;
/** A letter that is not from the Latin script. */
const FOREIGN_LETTER = /[^\P{L}\p{Script=Latin}]/u;

function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(ACCENTS, "")
    .toLowerCase()
    .split(NOT_LETTERS)
    .filter(Boolean);
}

/** Whether a text must never be shown. */
export function isBlocked(text: string): boolean {
  if (FOREIGN_LETTER.test(text)) {
    return true;
  }
  return words(text).some(
    (word) =>
      BLOCKED_WORDS.has(word) ||
      BLOCKED_ROOTS.some((root) => word.startsWith(root))
  );
}

/**
 * Model text as the world may keep it: one line of plain spaces, cut to
 * `maxLength`, or null when it is empty, not a string or blocked.
 */
export function filterModelText(
  text: unknown,
  maxLength: number
): string | null {
  if (typeof text !== "string") {
    return null;
  }
  const clean = text.replace(SPACES, " ").trim().slice(0, maxLength).trim();
  if (!clean || isBlocked(clean)) {
    return null;
  }
  return clean;
}
