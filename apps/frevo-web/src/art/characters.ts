// The thirty characters from the Ninja Adventure pack (CC0) and the eight
// frevo instruments. A boneco's `look` is an index into CHARACTERS; until the
// world sends one, it comes from a hash of the boneco's id.
import type { Facing } from "@gambiarra-lab/frevo/snapshot";

/** Order matters: `look` indexes this list, and the phone uses it too. */
export const CHARACTERS = [
  "villager-01",
  "villager-02",
  "villager-03",
  "villager-04",
  "villager-05",
  "villager-06",
  "villager-07",
  "villager-08",
  "villager-09",
  "villager-10",
  "villager-11",
  "villager-12",
  "villager-13",
  "villager-14",
  "villager-15",
  "ninja-01",
  "ninja-02",
  "ninja-03",
  "ninja-04",
  "ninja-05",
  "ninja-06",
  "ninja-07",
  "animal-01",
  "animal-02",
  "animal-03",
  "animal-04",
  "animal-05",
  "animal-06",
  "animal-07",
  "animal-08",
] as const;

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

/** Character sheets: 16 px frames, a column per facing, a row per walk frame. */
export const FRAME = 16;
export const WALK_FRAMES = 4;
export const WALK_FPS = 8;
export const SHEET_WIDTH = 64;
export const SHEET_HEIGHT = 112;
export const FACING_COLUMN: Record<Facing, number> = {
  down: 0,
  up: 1,
  left: 2,
  right: 3,
};

const ART = "/art";

function wrap(index: number) {
  const count = CHARACTERS.length;
  return ((Math.trunc(index) % count) + count) % count;
}

const HASH_MODULUS = 2_147_483_647;

/** A small, stable hash so the same id always gets the same look. */
export function hashId(id: string): number {
  let hash = 7;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 131 + (id.codePointAt(index) ?? 0)) % HASH_MODULUS;
  }
  return hash;
}

export function lookOf(boneco: { id: string; look?: number | null }): number {
  return wrap(
    typeof boneco.look === "number" ? boneco.look : hashId(boneco.id)
  );
}

export function characterSheetUrl(look: number) {
  return `${ART}/characters/${CHARACTERS[wrap(look)]}.png`;
}

/** The 38 x 38 portrait of a character. */
export function faceUrl(look: number) {
  return `${ART}/faces/${CHARACTERS[wrap(look)]}.png`;
}

export function instrumentOf(value: unknown): Instrument | null {
  return INSTRUMENTS.find((instrument) => instrument === value) ?? null;
}

/** Walk frame for a time, offset per boneco so the crowd does not march. */
export function walkFrame(timeMs: number, id: string): number {
  const offset = hashId(id) % 1000;
  return Math.floor(((timeMs + offset) * WALK_FPS) / 1000) % WALK_FRAMES;
}
