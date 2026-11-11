// The square, as tiles from the Ninja Adventure pack and as drawings made for
// it (`recife.ts`). It is the Marco Zero of Recife at carnival: the compass
// rose on the floor, the quay, and across the channel the reef with the Torre
// de Cristal. Everything here is in art pixels: the world is 320 x 180 (the
// simulation's 160 x 90 map units, two pixels each, 20 x 11.25 tiles of 16 px).
// Ground is painted once into a cached layer; props stand up and are drawn
// sorted by their base with the bonecos, so a boneco behind a stall is hidden
// by it.
import { MEETING_SPOTS } from "@gambiarra-lab/frevo/meeting-spots";
import { PRACA } from "@gambiarra-lab/frevo/snapshot";
import type { Drawing } from "./pixels";
import {
  bandeirinhas,
  CASARIOS,
  confetti,
  ESCULTURAS,
  GALO,
  GIGANTES,
  JANGADA,
  LETREIRO,
  PONTE,
  POSTE,
  REEF,
  ROSA_DOS_VENTOS,
  SEA,
  SHORE,
  STREET,
  type Tiles,
  TORRE,
} from "./recife";

export const TILE = 16;
export const PX_PER_UNIT = 2;
export const WORLD_WIDTH = PRACA.width * PX_PER_UNIT;
export const WORLD_HEIGHT = PRACA.height * PX_PER_UNIT;

const TILES = "/art/tiles";
export const SHEETS = {
  paving: `${TILES}/paving.png`,
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

/** A piece of art: a rectangle of a pack sheet, or a drawing made by code. */
export type Piece = Region | Drawing;

export const isDrawing = (piece: Piece): piece is Drawing => "cells" in piece;

/** A piece's size in art pixels. */
export function pieceSize(piece: Piece) {
  return isDrawing(piece)
    ? { w: piece.w, h: piece.h }
    : { w: piece.w * TILE, h: piece.h * TILE };
}

const region = (
  sheet: Sheet,
  col: number,
  row: number,
  w = 1,
  h = 1
): Region => ({ sheet, col, row, w, h });

export const REGIONS = {
  cobble: region("paving", 1, 13),
  cobbleN: region("paving", 1, 12),
  cobbleS: region("paving", 1, 14),
  cobbleW: region("paving", 0, 13),
  cobbleE: region("paving", 2, 13),
  cobbleNW: region("paving", 0, 12),
  cobbleNE: region("paving", 2, 12),
  cobbleSW: region("paving", 0, 14),
  cobbleSE: region("paving", 2, 14),
  frame: region("paving", 11, 0, 3, 3),
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
  piece: Piece;
  x: number;
  y: number;
}

/** Something standing, drawn sorted by `baseY`. Position of its top-left. */
export interface Prop {
  baseY: number;
  /** On the water: it rises and falls one pixel with the swell. */
  floats?: boolean;
  /** Animated strips: frames laid side by side. */
  frames?: number;
  piece: Piece;
  x: number;
  y: number;
}

/** A piece standing with the middle of its base on the ground at `at`. */
function standing(piece: Piece, at: { x: number; y: number }): Prop {
  const { w, h } = pieceSize(piece);
  return {
    piece,
    x: Math.round(at.x - w / 2),
    y: at.y - h,
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

/** Paved area in tiles: everything but a street around it and the quay. */
export const PAVED = { col0: 1, row0: 1, col1: 18, row1: 10 };
/** The world's top tile row: the quay's edge, the channel and the reef's face. */
export const SHORE_ROW = 0;
/** The reef, one row above the world; the open sea is everything above it. */
export const REEF_ROW = -1;
/** Where things stand on the reef, in art pixels. */
const REEF_Y = -3;
/** The tower stands at the reef's edge, where the walkway arrives. */
const TORRE_Y = 1;
/**
 * Art pixels above the world that hold the tower and the Galo: the telão
 * keeps them in view when the stage has the room (`fitWorld`).
 */
export const SCENERY_ABOVE = TORRE.h - TORRE_Y + 1;

function centred(piece: Piece, at: { x: number; y: number }): Decal {
  const { w, h } = pieceSize(piece);
  return {
    piece,
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - h / 2),
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
        piece: REGIONS[key],
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
const ponte = placeAt("ponte");

export const DECALS: Decal[] = [
  // The compass rose of the Marco Zero.
  centred(ROSA_DOS_VENTOS, marcoZero),
  // The coreto's floor.
  centred(REGIONS.frame, { x: coreto.x, y: coreto.y - 8 }),
  // The frevo stage: a wooden deck the bonecos climb on.
  ...deck(Math.round(palco.x / TILE) - 2, Math.round(palco.y / TILE) - 1, 4, 2),
  // The walkway over the channel, from the quay to the reef.
  { piece: PONTE, x: ponte.x - PONTE.w / 2, y: TILE - PONTE.h },
];

/** Confetti on the paving, painted with the ground. */
export const CONFETTI = confetti(
  { x: TILE + 4, y: TILE + 4, w: 18 * TILE - 8, h: 10 * TILE - 8 },
  260
);

/** A string of bandeirinhas between two points at the same height. */
function strung(from: number, to: number, y: number, baseY: number): Prop {
  return { piece: bandeirinhas(to - from + 1, 5), x: from, y, baseY };
}

/** Lamp posts in sombrinhas along the street below the square. */
const POSTES_Y = 201;
const POSTES_X = [28, 94, 160, 226, 292];
const SOMBRINHA_H = 6;

/** Sobrados close the corners of the square by the quay: where each row ends. */
const CASARIO_Y = 25;
const CASARIO_LEFT = 27;
const CASARIO_RIGHT = 293;
const leftOf = (piece: Drawing, x: number, y: number) =>
  standing(piece, { x: x - piece.w / 2, y });
const rightOf = (piece: Drawing, x: number, y: number) =>
  standing(piece, { x: x + piece.w / 2, y });

const { ovo, passaro, totem } = ESCULTURAS;

export const PROPS: Prop[] = [
  // The Parque das Esculturas on the reef: the Torre de Cristal in line with
  // the compass rose, as in the city, and smaller pieces beside it.
  standing(TORRE, { x: marcoZero.x, y: TORRE_Y }),
  standing(totem, { x: 114, y: REEF_Y }),
  standing(ovo, { x: 127, y: REEF_Y }),
  standing(passaro, { x: 141, y: REEF_Y }),
  standing(totem, { x: 181, y: REEF_Y }),
  standing(ovo, { x: 194, y: REEF_Y }),
  // The Galo da Madrugada and the city's name.
  standing(GALO, { x: 86, y: REEF_Y + 1 }),
  standing(LETREIRO, { x: 238, y: REEF_Y + 1 }),
  // Jangadas on the open sea.
  { ...standing(JANGADA, { x: 54, y: -23 }), floats: true },
  { ...standing(JANGADA, { x: 270, y: -27 }), floats: true },
  // Sobrados at the corners of the square and down the streets beside it.
  leftOf(CASARIOS.cais, CASARIO_LEFT, CASARIO_Y),
  rightOf(CASARIOS.alfandega, CASARIO_RIGHT, CASARIO_Y),
  leftOf(CASARIOS.bomJesus, -3, 104),
  leftOf(CASARIOS.aurora, -3, 176),
  rightOf(CASARIOS.aurora, 323, 104),
  rightOf(CASARIOS.bomJesus, 323, 176),
  // Coreto: banners at its back corners, bandeirinhas between them.
  standing(region("house", 23, 20, 1, 2), {
    x: coreto.x - 20,
    y: coreto.y - 18,
  }),
  standing(region("house", 25, 20, 1, 2), {
    x: coreto.x + 20,
    y: coreto.y - 18,
  }),
  strung(coreto.x - 17, coreto.x + 17, coreto.y - 48, coreto.y - 18),
  // Fountain: the basin stands right behind the spot people walk to.
  standing(region("desert", 8, 7, 2, 2), { x: fonte.x, y: fonte.y - 6 }),
  // Tapioca stall.
  standing(region("desert", 2, 10, 2, 2), { x: tapioca.x, y: tapioca.y - 6 }),
  // Frevo stage: banners behind the deck, bandeirinhas across them.
  standing(region("house", 22, 20, 1, 2), { x: palco.x - 24, y: palco.y - 14 }),
  standing(region("house", 24, 20, 1, 2), { x: palco.x, y: palco.y - 14 }),
  standing(region("house", 26, 20, 1, 2), { x: palco.x + 24, y: palco.y - 14 }),
  strung(palco.x - 21, palco.x - 3, palco.y - 44, palco.y - 14),
  strung(palco.x + 3, palco.x + 21, palco.y - 44, palco.y - 14),
  // A flag at each meeting spot.
  ...SPOTS.map((spot, index) => ({
    ...standing(region(FLAGS[index % FLAGS.length] as Sheet, 0, 0), {
      x: spot.x - 12,
      y: spot.y - 2,
    }),
    frames: 4,
  })),
  // Lamp posts on the streets beside the square, where bonecos never walk.
  standing(POSTE, { x: 8, y: 64 }),
  standing(POSTE, { x: 8, y: 128 }),
  standing(POSTE, { x: 312, y: 64 }),
  standing(POSTE, { x: 312, y: 128 }),
  // The street below the square, seen when the screen has room for it: lamp
  // posts with bandeirinhas from one to the next, giant puppets and palms.
  ...POSTES_X.map((x) => standing(POSTE, { x, y: POSTES_Y })),
  ...POSTES_X.slice(1).map((x, index) =>
    strung(
      (POSTES_X[index] ?? 0) + 2,
      x - 2,
      POSTES_Y - POSTE.h + SOMBRINHA_H,
      POSTES_Y
    )
  ),
  standing(GIGANTES.verde, { x: 61, y: 210 }),
  standing(GIGANTES.amarelo, { x: 259, y: 210 }),
  standing(region("desert", 10, 10, 2, 2), { x: 127, y: 222 }),
  standing(region("desert", 12, 10, 2, 2), { x: 193, y: 222 }),
  standing(region("desert", 10, 4, 4, 3), { x: -44, y: 232 }),
  standing(region("desert", 10, 7, 4, 3), { x: 364, y: 232 }),
];

/** A number from 0 to 96 for a tile, always the same one. */
function tileRoll(col: number, row: number) {
  const mixed = col * 92_821 + row * 68_917 + col * row * 7;
  return ((mixed % 97) + 97) % 97;
}

/** One tile of a list, going around it. */
function pick(tiles: Tiles, index: number): Drawing {
  return (
    tiles[((index % tiles.length) + tiles.length) % tiles.length] ?? tiles[0]
  );
}

/** The open sea darkens away from the reef; a wave glints here and there. */
function seaAt(col: number, row: number): Drawing {
  const tiles = SEA[Math.min(REEF_ROW - 1 - row, SEA.length - 1)] ?? SEA[0];
  const roll = tileRoll(col, row);
  return roll < 30 ? pick(tiles, 1 + (roll % (tiles.length - 1))) : tiles[0];
}

/** The ground tile at a tile position, inside or around the world. */
export function groundAt(col: number, row: number): Piece {
  if (row < REEF_ROW) {
    return seaAt(col, row);
  }
  if (row === REEF_ROW) {
    return pick(REEF, tileRoll(col, row));
  }
  if (row === SHORE_ROW) {
    return pick(SHORE, col);
  }
  const { col0, row0, col1, row1 } = PAVED;
  if (col >= col0 && col <= col1 && row >= row0 && row <= row1) {
    const key =
      `cobble${slice(row - row0, row1 - row0, "N", "S")}${slice(col - col0, col1 - col0, "W", "E")}` as keyof typeof REGIONS;
    return REGIONS[key];
  }
  return STREET;
}
