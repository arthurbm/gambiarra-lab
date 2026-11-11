// Letter sizes for the bloco on stage, from the length of its texts, so a
// 40-letter name and four 60-letter verses still fit the card on a 16:9
// telão without wrapping into lines that push the members out of view. The
// card is about 60vw wide; a bold letter takes about 0.58 of its size.

/** vw of card width per character at the size that keeps one line. */
const NAME_WIDTH_VW = 100;
const NAME_MAX_VW = 4.6;
const NAME_MIN_VW = 1.8;
const REFRAIN_WIDTH_VW = 100;
const REFRAIN_MAX_VW = 3.3;
const REFRAIN_MIN_VW = 1.4;

function fit(chars: number, width: number, min: number, max: number) {
  const size = chars > 0 ? width / chars : max;
  return Math.round(Math.min(max, Math.max(min, size)) * 100) / 100;
}

export function nameSizeVw(name: string): number {
  return fit(name.length, NAME_WIDTH_VW, NAME_MIN_VW, NAME_MAX_VW);
}

export function refrainSizeVw(lines: readonly string[]): number {
  const longest = Math.max(0, ...lines.map((line) => line.length));
  return fit(longest, REFRAIN_WIDTH_VW, REFRAIN_MIN_VW, REFRAIN_MAX_VW);
}
