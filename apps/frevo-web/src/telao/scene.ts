// The square, as tiles from the Ninja Adventure pack. Everything here is in
// art pixels: the world is 320 x 180 (the simulation's 160 x 90 map units,
// two pixels each, 20 x 11.25 tiles of 16 px). Ground is painted once into a
// cached layer; props stand up and are drawn sorted by their base with the
// bonecos, so a boneco behind a stall is hidden by it.
import { MEETING_SPOTS } from "@gambiarra-lab/frevo/meeting-spots";
import { PRACA } from "@gambiarra-lab/frevo/snapshot";

export const TILE = 16;
export const PX_PER_UNIT = 2;
export const WORLD_WIDTH = PRACA.width * PX_PER_UNIT;
export const WORLD_HEIGHT = PRACA.height * PX_PER_UNIT;

const TILES = "/art/tiles";
export const SHEETS = {
  floor: `${TILES}/floor.png`,
  paving: `${TILES}/paving.png`,
  nature: `${TILES}/nature.png`,
  house: `${TILES}/house.png`,
  water: `${TILES}/water.png`,
  desert: `${TILES}/desert.png`,
  flagRed: `${TILES}/flag-red.png`,
  flagYellow: `${TILES}/flag-yellow.png`,
  flagBlue: `${TILES}/flag-blue.png`,
  flagGreen: `${TILES}/flag-green.png`,
} as const;
export type Sheet = keyof typeof SHEETS;

/** A rectangle of a sheet, in tiles. */
export interface Region {
  col: number;
  h: number;
  row: number;
  sheet: Sheet;
  w: number;
}

const region = (
  sheet: Sheet,
  col: number,
  row: number,
  w = 1,
  h = 1
): Region => ({ sheet, col, row, w, h });

export const REGIONS = {
  grass: region("floor", 0, 12),
  grassDetail: [1, 2, 3, 4].map((col) => region("floor", col, 12)),
  cobble: region("paving", 1, 13),
  cobbleN: region("paving", 1, 12),
  cobbleS: region("paving", 1, 14),
  cobbleW: region("paving", 0, 13),
  cobbleE: region("paving", 2, 13),
  cobbleNW: region("paving", 0, 12),
  cobbleNE: region("paving", 2, 12),
  cobbleSW: region("paving", 0, 14),
  cobbleSE: region("paving", 2, 14),
  medallion: region("paving", 15, 0, 4, 4),
  frame: region("paving", 11, 0, 3, 3),
  riverTop: region("water", 1, 6),
  river: region("water", 1, 7),
  riverBottom: region("water", 1, 8),
  deckNW: region("water", 0, 12),
  deckN: region("water", 1, 12),
  deckNE: region("water", 2, 12),
  deckW: region("water", 0, 13),
  deck: region("water", 1, 13),
  deckE: region("water", 2, 13),
  deckSW: region("water", 0, 14),
  deckS: region("water", 1, 14),
  deckSE: region("water", 2, 14),
};

/** Something flat on the ground, painted once. Position of its top-left. */
export interface Decal {
  region: Region;
  x: number;
  y: number;
}

/** Something standing, drawn sorted by `baseY`. Position of its top-left. */
export interface Prop {
  baseY: number;
  /** Animated strips: frames laid side by side. */
  frames?: number;
  region: Region;
  x: number;
  y: number;
}

function standing(
  sheet: Sheet,
  col: number,
  row: number,
  w: number,
  h: number,
  /** Where its base touches the ground. */
  at: { x: number; y: number }
): Prop {
  return {
    region: region(sheet, col, row, w, h),
    x: at.x - (w * TILE) / 2,
    y: at.y - h * TILE,
    baseY: at.y,
  };
}

const placeAt = (id: string) => {
  const place = PRACA.places.find((candidate) => candidate.id === id);
  if (!place) {
    throw new Error(`PRACA has no place ${id}`);
  }
  return { x: place.x * PX_PER_UNIT, y: place.y * PX_PER_UNIT };
};

/** Paved area in tiles: everything but a grass border and the river bank. */
export const PAVED = { col0: 1, row0: 1, col1: 18, row1: 10 };
/** Tile rows of the river along the top; the bridge crosses it. */
export const RIVER_ROWS = { top: -3, bottom: 0 };
export const BRIDGE_COLS = { left: 9, right: 10 };

function centred(r: Region, at: { x: number; y: number }): Decal {
  return {
    region: r,
    x: at.x - (r.w * TILE) / 2,
    y: at.y - (r.h * TILE) / 2,
  };
}

/** Which piece of a 9-slice a tile is: "N", "SW", "" for the middle. */
function slice(index: number, last: number, first: string, end: string) {
  if (index === 0) {
    return first;
  }
  return index === last ? end : "";
}

function deck(col0: number, row0: number, cols: number, rows: number) {
  const decals: Decal[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const key =
        `deck${slice(row, rows - 1, "N", "S")}${slice(col, cols - 1, "W", "E")}` as keyof typeof REGIONS;
      decals.push({
        region: REGIONS[key] as Region,
        x: (col0 + col) * TILE,
        y: (row0 + row) * TILE,
      });
    }
  }
  return decals;
}

const FLAGS: Sheet[] = ["flagRed", "flagYellow", "flagBlue", "flagGreen"];

/** Meeting spots in art pixels, in the order the simulation lists them. */
export const SPOTS = MEETING_SPOTS.map((spot) => ({
  id: spot.id,
  x: spot.x * PX_PER_UNIT,
  y: spot.y * PX_PER_UNIT,
}));

const marcoZero = placeAt("marco-zero");
const coreto = placeAt("coreto");
const fonte = placeAt("fonte");
const tapioca = placeAt("tapioca");
const palco = placeAt("palco");

export const DECALS: Decal[] = [
  // Marco Zero's compass rose.
  centred(REGIONS.medallion, marcoZero),
  // The coreto's floor.
  centred(REGIONS.frame, { x: coreto.x, y: coreto.y - 8 }),
  // The frevo stage: a wooden deck the bonecos climb on.
  ...deck(Math.round(palco.x / TILE) - 2, Math.round(palco.y / TILE) - 1, 4, 2),
  // The bridge over the river.
  ...deck(BRIDGE_COLS.left, RIVER_ROWS.top - 1, 2, -RIVER_ROWS.top + 2),
];

export const PROPS: Prop[] = [
  // Coreto: banners at its back corners.
  standing("house", 23, 20, 1, 2, { x: coreto.x - 20, y: coreto.y - 18 }),
  standing("house", 25, 20, 1, 2, { x: coreto.x + 20, y: coreto.y - 18 }),
  // Fountain: the basin stands right behind the spot people walk to.
  standing("desert", 8, 7, 2, 2, { x: fonte.x, y: fonte.y - 6 }),
  // Tapioca stall.
  standing("desert", 2, 10, 2, 2, { x: tapioca.x, y: tapioca.y - 6 }),
  // Frevo stage: banners behind the deck.
  standing("house", 22, 20, 1, 2, { x: palco.x - 24, y: palco.y - 14 }),
  standing("house", 24, 20, 1, 2, { x: palco.x, y: palco.y - 14 }),
  standing("house", 26, 20, 1, 2, { x: palco.x + 24, y: palco.y - 14 }),
  // A flag at each meeting spot.
  ...SPOTS.map((spot, index) => ({
    ...standing(FLAGS[index % FLAGS.length] as Sheet, 0, 0, 1, 1, {
      x: spot.x - 12,
      y: spot.y - 2,
    }),
    frames: 4,
  })),
  // Plants on the grass border, where bonecos never walk.
  standing("nature", 0, 10, 1, 1, { x: 8, y: 40 }),
  standing("nature", 3, 11, 1, 1, { x: 8, y: 96 }),
  standing("nature", 1, 10, 1, 1, { x: 8, y: 150 }),
  standing("nature", 0, 11, 1, 1, { x: 312, y: 44 }),
  standing("nature", 2, 10, 1, 1, { x: 312, y: 100 }),
  standing("nature", 6, 11, 1, 1, { x: 312, y: 156 }),
  // Scenery around the square, seen when the screen has room for it.
  standing("house", 0, 0, 4, 3, { x: 40, y: -52 }),
  standing("house", 16, 0, 3, 3, { x: 100, y: -52 }),
  standing("house", 12, 0, 4, 3, { x: 220, y: -52 }),
  standing("house", 23, 0, 3, 3, { x: 284, y: -52 }),
  standing("nature", 3, 18, 3, 3, { x: -32, y: 40 }),
  standing("desert", 10, 4, 4, 3, { x: -40, y: 110 }),
  standing("nature", 0, 0, 2, 2, { x: -24, y: 176 }),
  standing("nature", 0, 18, 3, 3, { x: 352, y: 40 }),
  standing("desert", 10, 7, 4, 3, { x: 360, y: 110 }),
  standing("nature", 16, 0, 2, 2, { x: 344, y: 176 }),
  standing("desert", 10, 10, 2, 2, { x: 48, y: 214 }),
  standing("nature", 14, 0, 2, 2, { x: 132, y: 216 }),
  standing("nature", 0, 0, 2, 2, { x: 196, y: 216 }),
  standing("desert", 12, 10, 2, 2, { x: 276, y: 214 }),
];

/** The ground tile at a tile position, inside or around the world. */
export function groundAt(col: number, row: number): Region {
  if (row >= RIVER_ROWS.top && row <= RIVER_ROWS.bottom) {
    if (row === RIVER_ROWS.top) {
      return REGIONS.riverTop;
    }
    return row === RIVER_ROWS.bottom ? REGIONS.riverBottom : REGIONS.river;
  }
  const { col0, row0, col1, row1 } = PAVED;
  if (col >= col0 && col <= col1 && row >= row0 && row <= row1) {
    const key =
      `cobble${slice(row - row0, row1 - row0, "N", "S")}${slice(col - col0, col1 - col0, "W", "E")}` as keyof typeof REGIONS;
    return REGIONS[key] as Region;
  }
  // A few tufts in the grass, always the same ones.
  const mixed = col * 92_821 + row * 68_917 + col * row * 7;
  const roll = ((mixed % 97) + 97) % 97;
  return roll < 12 ? (REGIONS.grassDetail[roll % 4] as Region) : REGIONS.grass;
}
