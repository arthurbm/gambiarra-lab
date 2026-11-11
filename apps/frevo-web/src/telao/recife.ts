// Recife, drawn for this experience: what the Ninja Adventure pack does not
// have. The Torre de Cristal of Francisco Brennand on the reef, the Galo da
// Madrugada, the sobrados of the Recife Antigo, the compass rose of the Marco
// Zero and the carnival decoration. Everything is painted by code in the
// pack's colours, as the instrument icons are, and is plain data here.
import {
  blank,
  type Drawing,
  ellipse,
  line,
  outline,
  type Palette,
  paste,
  put,
  rect,
  stamp,
} from "./pixels";

const TILE = 16;
const INK = "#141b1b";

const COLORS = {
  K: INK,
  W: "#fbf3e3",
  w: "#d9d3c4",
  G: "#9ba7aa",
  g: "#6f7b80",
  R: "#e0394c",
  r: "#a3283a",
  O: "#ffad5d",
  o: "#e66a3a",
  Y: "#f1c471",
  y: "#d9a441",
  H: "#fbe9b0",
  B: "#3f7fd1",
  b: "#2c5aa0",
  C: "#71ddee",
  c: "#3bb5ad",
  V: "#74a334",
  v: "#4a7f4b",
  M: "#b35fc4",
  m: "#e8829a",
  N: "#965340",
  n: "#61372e",
  T: "#c8763f",
  S: "#f3c9a0",
} as const satisfies Palette;

/** The colours of a frevo sombrinha, and of everything hung for carnival. */
const FESTA = [
  COLORS.R,
  COLORS.Y,
  COLORS.B,
  COLORS.V,
  COLORS.O,
  COLORS.M,
] as const;

// Ground. The square looks at the water as the Marco Zero does: a stone quay,
// a channel, the reef with the sculpture park and the open sea behind it.

/** The channel between the quay and the reef: the pack's own water. */
const CHANNEL = COLORS.C;
/** The open sea, nearer to farther. */
const SEA_COLORS = ["#5ac6e6", "#4bb3dc", "#3fa1d1"] as const;
const GLINT = "#aeeaf5";
const FOAM = "#ffffff";

const GLINTS = [
  [],
  [
    { x: 2, y: 4, w: 4 },
    { x: 10, y: 11, w: 3 },
  ],
  [{ x: 7, y: 8, w: 5 }],
] as const;

function seaTile(color: string, variant: number) {
  const tile = blank(TILE, TILE, color);
  for (const glint of GLINTS[variant % GLINTS.length] ?? []) {
    rect(tile, glint.x, glint.y, glint.w, 1, GLINT);
  }
  return tile;
}

/** A list a tile is picked from: it always has a first one. */
export type Tiles = readonly [Drawing, ...Drawing[]];

/** Open sea tiles, nearer to farther; in each, the plain one comes first. */
export const SEA: readonly [Tiles, ...Tiles[]] = [
  [
    seaTile(SEA_COLORS[0], 0),
    seaTile(SEA_COLORS[0], 1),
    seaTile(SEA_COLORS[0], 2),
  ],
  [
    seaTile(SEA_COLORS[1], 0),
    seaTile(SEA_COLORS[1], 1),
    seaTile(SEA_COLORS[1], 2),
  ],
  [
    seaTile(SEA_COLORS[2], 0),
    seaTile(SEA_COLORS[2], 1),
    seaTile(SEA_COLORS[2], 2),
  ],
];

const STONE = { light: "#d8ceb9", base: "#b9ac95", dark: "#978a75" };
const ROCK = { base: "#857a6c", dark: "#665c53" };

/** The reef seen from the square: sea and surf behind, flat stone on top. */
function reefTile(variant: number) {
  const tile = blank(TILE, TILE, SEA_COLORS[0]);
  for (let x = 0; x < TILE; x += 1) {
    if ((x + variant * 5) % 8 < 5) {
      put(tile, x, 5, FOAM);
    }
    put(tile, x, 6, (x + variant * 3) % 7 === 0 ? GLINT : FOAM);
  }
  rect(tile, 0, 7, TILE, 1, STONE.light);
  rect(tile, 0, 8, TILE, 8, STONE.base);
  const marks = variant === 0 ? [2, 9, 13] : [5, 11];
  for (const [index, x] of marks.entries()) {
    rect(tile, x, 10 + ((index * 2) % 5), 2, 1, STONE.dark);
    put(tile, (x + 6) % TILE, 9 + ((index * 3) % 6), STONE.light);
  }
  return tile;
}

/** The tile row above the world. */
export const REEF: Tiles = [reefTile(0), reefTile(1)];

/** The reef's face, the channel and the quay's stone edge. */
function shoreTile(variant: number) {
  const tile = blank(TILE, TILE, CHANNEL);
  rect(tile, 0, 0, TILE, 3, ROCK.base);
  for (let x = variant * 3; x < TILE; x += 5) {
    put(tile, x, 1, ROCK.dark);
    put(tile, x + 2, 2, ROCK.dark);
  }
  rect(tile, 0, 3, TILE, 1, "#79b8ce");
  rect(tile, variant === 0 ? 3 : 9, 7, 4, 1, GLINT);
  rect(tile, 0, 11, TILE, 1, "#79b8ce");
  rect(tile, 0, 12, TILE, 1, COLORS.W);
  rect(tile, 0, 13, TILE, 2, "#eadfca");
  rect(tile, 0, 15, TILE, 1, STONE.dark);
  rect(tile, variant === 0 ? 7 : 15, 13, 1, 2, STONE.base);
  return tile;
}

/** The world's top tile row. */
export const SHORE: Tiles = [shoreTile(0), shoreTile(1)];

const PAVEMENT = { light: "#a99b8d", base: "#94877b", joint: "#7b7067" };

/** The streets around the square: grey paving stones, four rows to a tile. */
function streetTile() {
  const tile = blank(TILE, TILE, PAVEMENT.base);
  for (let row = 0; row < 4; row += 1) {
    const y = row * 4;
    rect(tile, 0, y, TILE, 1, PAVEMENT.light);
    rect(tile, 0, y + 3, TILE, 1, PAVEMENT.joint);
    for (let x = row % 2 === 0 ? 7 : 3; x < TILE; x += 8) {
      rect(tile, x, y, 1, 3, PAVEMENT.joint);
    }
  }
  return tile;
}

export const STREET = streetTile();

/** The walkway from the quay to the reef, in the pack's deck colours. */
function ponte() {
  const bridge = blank(20, 17, COLORS.O);
  for (let y = 2; y < bridge.h; y += 3) {
    rect(bridge, 0, y, bridge.w, 1, COLORS.o);
  }
  for (const x of [0, bridge.w - 2]) {
    rect(bridge, x, 0, 2, bridge.h, COLORS.N);
    rect(bridge, x === 0 ? 0 : x + 1, 0, 1, bridge.h, INK);
  }
  rect(bridge, 0, 0, bridge.w, 1, INK);
  return bridge;
}

export const PONTE = ponte();

// The compass rose on the floor of the Marco Zero, after Cícero Dias's.

const ROSA_SIZE = 61;
const ROSA_STONE = "#f6e7c8";
const ROSA_POINTS = [
  { light: COLORS.R, dark: COLORS.r },
  { light: COLORS.B, dark: COLORS.b },
  { light: COLORS.Y, dark: COLORS.y },
  { light: COLORS.V, dark: COLORS.v },
] as const;

/**
 * How far a four-pointed star reaches in a direction: `tip` at each quarter
 * turn, `waist` halfway between two tips.
 */
function starReach(angle: number, tip: number, waist: number) {
  const quarter = Math.PI / 2;
  const turned = ((angle % quarter) + quarter) % quarter;
  const fromTip = Math.min(turned, quarter - turned);
  const half = quarter / 2;
  return (
    (tip * waist * Math.sin(half)) /
    (waist * Math.sin(half - fromTip) + tip * Math.sin(fromTip))
  );
}

function rosaColor(dx: number, dy: number): string | null {
  const distance = Math.hypot(dx, dy);
  if (distance <= 2.6) {
    return COLORS.H;
  }
  if (distance <= 4.2) {
    return COLORS.N;
  }
  // Up is north; the angle grows clockwise from it.
  const angle = Math.atan2(dx, -dy) + Math.PI * 2;
  const quarter = Math.PI / 2;
  if (distance <= starReach(angle, 22, 9)) {
    const point = Math.round(angle / quarter) % 4;
    const side = angle - Math.round(angle / quarter) * quarter;
    const colors = ROSA_POINTS[point] ?? ROSA_POINTS[0];
    return side < 0 ? colors.light : colors.dark;
  }
  const diagonal = angle - quarter / 2;
  if (distance <= starReach(diagonal, 16, 8)) {
    const side = diagonal - Math.round(diagonal / quarter) * quarter;
    return side < 0 ? COLORS.O : COLORS.o;
  }
  if (distance <= 22.5) {
    return ROSA_STONE;
  }
  if (distance <= 24) {
    return COLORS.N;
  }
  if (distance <= 28.5) {
    // A band of sixteen stones, every other one in a colour of the points.
    const stone = Math.floor((angle / (Math.PI * 2)) * 16) % 16;
    const colors = ROSA_POINTS[((stone - 1) / 2) % 4];
    return colors ? colors.light : ROSA_STONE;
  }
  return distance <= 30.5 ? COLORS.N : null;
}

function rosaDosVentos() {
  const rosa = blank(ROSA_SIZE, ROSA_SIZE);
  const centre = (ROSA_SIZE - 1) / 2;
  for (let y = 0; y < ROSA_SIZE; y += 1) {
    for (let x = 0; x < ROSA_SIZE; x += 1) {
      put(rosa, x, y, rosaColor(x - centre, y - centre));
    }
  }
  return rosa;
}

export const ROSA_DOS_VENTOS = rosaDosVentos();

// The Parque das Esculturas, on the reef in front of the Marco Zero.

/** The Torre de Cristal: a ceramic column with a bronze bud on top. */
function torre() {
  const tower = blank(19, 41);
  stamp(
    tower,
    [
      ".........K.........",
      "........KHK........",
      "........KYK........",
      ".......KYHYK.......",
      ".......KYHyK.......",
      "......KYYHyyK......",
      "......KYYHyyK......",
      "......KYYHyyK......",
      ".......KYHyK.......",
      "........KyK........",
      "......KKKKKKK......",
      ".....KWWWWWWwK.....",
      ".....KBCBCBCBK.....",
      "......KKKKKKK......",
    ],
    0,
    0,
    COLORS
  );
  // The upper shaft, the ring and the wider lower shaft, each with the blue
  // of its tiles climbing in a spiral.
  for (let y = 14; y < 23; y += 1) {
    stamp(tower, ["......KWWWWwK......"], 0, y, COLORS);
    put(tower, 7 + (y % 4), y, COLORS.B);
    put(tower, 7 + ((y + 2) % 4), y, COLORS.C);
  }
  stamp(tower, [".....KWWWWWWwK.....", ".....KbBBBBBbK....."], 0, 23, COLORS);
  for (let y = 25; y < 35; y += 1) {
    stamp(tower, [".....KWWWWWWwK....."], 0, y, COLORS);
    put(tower, 6 + (y % 6), y, COLORS.B);
    put(tower, 6 + ((y + 1) % 6), y, COLORS.C);
    put(tower, 6 + ((y + 3) % 6), y, COLORS.B);
  }
  stamp(
    tower,
    [
      "....KWWWWWWWWwK....",
      "....KBCBCBCBCBK....",
      "...KWWWWWWWWWWwK...",
      "...KwwwwwwwwwwwK...",
      "..KGGGGGGGGGGGGgK..",
      "..KKKKKKKKKKKKKKK..",
    ],
    0,
    35,
    COLORS
  );
  return tower;
}

export const TORRE = torre();

function fromRows(rows: readonly string[], palette: Palette = COLORS) {
  const drawing = blank(rows[0]?.length ?? 0, rows.length);
  stamp(drawing, rows, 0, 0, palette);
  return drawing;
}

/** Smaller pieces of the park: an egg on a column, a bird, a glazed totem. */
export const ESCULTURAS = {
  ovo: fromRows([
    "..KKK..",
    ".KWWWK.",
    ".KWWwK.",
    ".KWWwK.",
    "..KwK..",
    ".KKKKK.",
    ".KTTTK.",
    "..KTK..",
    "..KTK..",
    "..KTK..",
    "..KTK..",
    ".KTTTK.",
    "KTTTTNK",
    "KKKKKKK",
  ]),
  passaro: fromRows([
    "....KK...",
    "...KWWK..",
    "...KWKWKK",
    "...KWWYYK",
    "..KWWKKK.",
    ".KWWWK...",
    "KWWWWK...",
    "KWWwwK...",
    ".KKKK....",
    "..KTK....",
    "..KTK....",
    ".KTTNK...",
    "KKKKKKK..",
  ]),
  totem: fromRows([
    "..KKK..",
    ".KBBBK.",
    ".KBCBK.",
    "..KbK..",
    ".KBBBK.",
    ".KBCBK.",
    "..KbK..",
    ".KBBBK.",
    ".KBCBK.",
    "..KbK..",
    ".KTTNK.",
    "KKKKKKK",
  ]),
};

// Carnival.

const TAIL = [
  { color: COLORS.B, tip: { x: 9, y: 3 } },
  { color: COLORS.R, tip: { x: 5, y: 5 } },
  { color: COLORS.Y, tip: { x: 2, y: 9 } },
  { color: COLORS.V, tip: { x: 1, y: 14 } },
  { color: COLORS.O, tip: { x: 3, y: 19 } },
] as const;

/** The Galo da Madrugada, the giant rooster that opens Recife's carnival. */
function galo() {
  const rooster = blank(31, 35);
  for (const feather of TAIL) {
    for (const [dx, dy] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ] as const) {
      line(
        rooster,
        { x: 11 + dx, y: 17 + dy },
        { x: feather.tip.x + dx, y: feather.tip.y + dy },
        feather.color
      );
    }
    ellipse(
      rooster,
      feather.tip.x + 0.5,
      feather.tip.y + 0.5,
      1.6,
      1.6,
      feather.color
    );
  }
  // Comb, then the white of the body, neck and head over it.
  ellipse(rooster, 21, 4.5, 1.4, 1.6, COLORS.R);
  ellipse(rooster, 23.5, 3.5, 1.6, 2, COLORS.R);
  ellipse(rooster, 26, 4.5, 1.4, 1.6, COLORS.R);
  ellipse(rooster, 15.5, 20, 7.5, 6, COLORS.W);
  ellipse(rooster, 20.5, 15.5, 4, 5.5, COLORS.W);
  ellipse(rooster, 22.5, 11, 3, 4.5, COLORS.W);
  ellipse(rooster, 23.5, 7.5, 3.2, 3, COLORS.W);
  rect(rooster, 12, 24, 8, 2, COLORS.w);
  // Wing, in the colours of a sombrinha.
  ellipse(rooster, 14.5, 20.5, 4.5, 3, COLORS.O);
  rect(rooster, 11, 20, 8, 1, COLORS.Y);
  rect(rooster, 12, 22, 6, 1, COLORS.R);
  // Face.
  put(rooster, 24, 7, INK);
  rect(rooster, 27, 7, 2, 1, COLORS.Y);
  rect(rooster, 27, 8, 3, 1, COLORS.y);
  ellipse(rooster, 26, 11, 1, 1.6, COLORS.R);
  // Legs and the stand it is carried on.
  for (const x of [13, 18]) {
    rect(rooster, x, 26, 1, 4, COLORS.y);
    rect(rooster, x - 1, 29, 4, 1, COLORS.Y);
  }
  rect(rooster, 7, 30, 18, 1, COLORS.W);
  for (let x = 7; x < 25; x += 1) {
    rect(rooster, x, 31, 1, 3, FESTA[Math.floor((x - 7) / 3) % 3] ?? COLORS.R);
  }
  outline(rooster, INK);
  return rooster;
}

export const GALO = galo();

const LETTERS: Record<string, readonly string[]> = {
  R: [
    "XXXXX.",
    "XXXXXX",
    "XX..XX",
    "XX..XX",
    "XXXXX.",
    "XXXX..",
    "XX.XX.",
    "XX..XX",
    "XX..XX",
  ],
  E: [
    "XXXXXX",
    "XXXXXX",
    "XX....",
    "XX....",
    "XXXXX.",
    "XX....",
    "XX....",
    "XXXXXX",
    "XXXXXX",
  ],
  C: [
    ".XXXXX",
    "XXXXXX",
    "XX....",
    "XX....",
    "XX....",
    "XX....",
    "XX....",
    "XXXXXX",
    ".XXXXX",
  ],
  I: ["XXXX", "XXXX", ".XX.", ".XX.", ".XX.", ".XX.", ".XX.", "XXXX", "XXXX"],
  F: [
    "XXXXXX",
    "XXXXXX",
    "XX....",
    "XX....",
    "XXXXX.",
    "XXXXX.",
    "XX....",
    "XX....",
    "XX....",
  ],
};

/** The letters of the city's name, one colour each, as on the quay. */
function letreiro(word: string) {
  const glyphs = [...word].map((letter) => LETTERS[letter] ?? []);
  const width = glyphs.reduce(
    (sum, glyph) => sum + (glyph[0]?.length ?? 0) + 2,
    0
  );
  const sign = blank(width, 11);
  let x = 1;
  for (const [index, glyph] of glyphs.entries()) {
    stamp(sign, glyph, x, 1, { X: FESTA[index % FESTA.length] ?? COLORS.R });
    x += (glyph[0]?.length ?? 0) + 2;
  }
  outline(sign, INK);
  return sign;
}

export const LETREIRO = letreiro("RECIFE");

/** A lamp post wearing a frevo sombrinha, as the streets do in February. */
export const POSTE = fromRows([
  "......K......",
  "....KKYKK....",
  "..KKRRYVVKK..",
  ".KBRRRYVVVMK.",
  "KBBRRRYVVVMMK",
  "KKKKKKWKKKKKK",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KwK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KwK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KWK.....",
  ".....KwK.....",
  ".....KWK.....",
  ".....KWK.....",
  "....KKWKK....",
  "....KGGGK....",
  "....KKKKK....",
]);

/** How far a string of bandeirinhas hangs below its ends, at pixel `x`. */
function sagAt(x: number, width: number, sag: number) {
  const t = width > 1 ? x / (width - 1) : 0;
  return Math.round(sag * 4 * t * (1 - t));
}

/** A string of bandeirinhas between two points at the same height. */
export function bandeirinhas(width: number, sag: number): Drawing {
  const string = blank(width, sag + 4);
  for (let x = 0; x < width; x += 1) {
    put(string, x, sagAt(x, width, sag), COLORS.n);
  }
  for (let x = 3, flag = 0; x < width - 3; x += 6, flag += 1) {
    const y = sagAt(x, width, sag) + 1;
    const color = FESTA[flag % FESTA.length] ?? COLORS.R;
    rect(string, x - 1, y, 3, 2, color);
    put(string, x, y + 2, color);
  }
  return string;
}

const GIGANTE_ROWS = [
  "....KKKKK....",
  "....KhhhK....",
  "....KhhhK....",
  "..KKKKKKKKK..",
  "...KSSSSSK...",
  "...KSKSKSK...",
  "...KSSSSSK...",
  "...KSRRRSK...",
  "....KSSSK....",
  "..KKKWWWKKK..",
  ".KAAAAWAAAAK.",
  "KAAAAADAAAAAK",
  "KAKAAAWAAAKAK",
  "KAKAAADAAAKAK",
  "KSKAAAWAAAKSK",
  ".KKAAADAAAKK.",
  "..KAAAAAAAK..",
  "..KAAAAAAAK..",
  "..KAAAAAAAK..",
  "..KaAAAAAaK..",
  "..KaAAAAAaK..",
  "..KaaAAAaaK..",
  "..KKKKKKKKK..",
] as const;

/** A giant carnival puppet: `A` its clothes, `D` the buttons, `h` the hat. */
function gigante(clothes: { A: string; a: string; D: string; h: string }) {
  return fromRows(GIGANTE_ROWS, { ...COLORS, ...clothes });
}

export const GIGANTES = {
  verde: gigante({ A: COLORS.V, a: COLORS.v, D: COLORS.Y, h: "#2b3238" }),
  amarelo: gigante({ A: COLORS.Y, a: COLORS.y, D: COLORS.R, h: COLORS.R }),
};

/** A jangada under sail. */
export const JANGADA = fromRows([
  ".....K......",
  "....KWK.....",
  "....KWWK....",
  "...KWWWK....",
  "...KWWWWK...",
  "..KWWWwwK...",
  "..KWWwwwwK..",
  ".KKKKKNKKK..",
  "......N.....",
  "KNNNNNNNNNNK",
  ".KnnnnnnnnK.",
  "..KKKKKKKK..",
]);

// The sobrados of the Recife Antigo: narrow, tall and each one a colour.

interface Sobrado {
  door: string;
  floors: 2 | 3;
  /** A curved gable over the cornice. */
  gable: boolean;
  wall: string;
  width: number;
}

const ROOF = 6;
const CORNICE = 2;
const FLOOR = 12;
const OPENING = 5;
const GLASS = "#2c3f66";

function sobradoHeight(sobrado: Sobrado) {
  return ROOF + CORNICE + sobrado.floors * FLOOR + 1;
}

/** The x of each window or door, evenly spread across the front. */
function openings(width: number) {
  const count = width >= 25 ? 3 : 2;
  const gap = (width - 2 - count * OPENING) / (count + 1);
  return Array.from({ length: count }, (_, index) =>
    Math.round(1 + gap + index * (OPENING + gap))
  );
}

function paintWindow(front: Drawing, x: number, y: number) {
  rect(front, x, y + 1, OPENING, 8, COLORS.W);
  rect(front, x + 1, y, OPENING - 2, 1, COLORS.W);
  rect(front, x + 1, y + 1, OPENING - 2, 6, GLASS);
  put(front, x + 1, y + 1, COLORS.C);
  // The balcony's iron rail.
  rect(front, x - 1, y + 7, OPENING + 2, 1, COLORS.g);
  rect(front, x - 1, y + 9, OPENING + 2, 1, INK);
  for (let bar = x - 1; bar < x + OPENING + 1; bar += 2) {
    put(front, bar, y + 8, INK);
  }
}

function paintDoor(front: Drawing, x: number, y: number, color: string) {
  rect(front, x, y + 1, OPENING, 10, COLORS.W);
  rect(front, x + 1, y, OPENING - 2, 1, COLORS.W);
  rect(front, x + 1, y + 1, OPENING - 2, 2, GLASS);
  rect(front, x + 1, y + 3, OPENING - 2, 8, color);
  rect(front, x + 2, y + 3, 1, 8, INK);
}

function paintSobrado(sobrado: Sobrado) {
  const { width } = sobrado;
  const height = sobradoHeight(sobrado);
  const front = blank(width, height, sobrado.wall);
  // Clay tiles, seen from above the cornice.
  rect(front, 0, 0, width, ROOF, COLORS.o);
  rect(front, 0, 1, width, 1, COLORS.O);
  for (let x = 2; x < width; x += 3) {
    rect(front, x, 2, 1, ROOF - 2, COLORS.N);
  }
  rect(front, 0, ROOF, width, 1, COLORS.W);
  rect(front, 0, ROOF + 1, width, 1, COLORS.w);
  if (sobrado.gable) {
    const middle = Math.floor(width / 2);
    for (let row = 0; row < 5; row += 1) {
      rect(front, middle - 1 - row, 1 + row, 3 + row * 2, 1, COLORS.W);
    }
    rect(front, middle - 1, 3, 3, 2, sobrado.wall);
  }
  const xs = openings(width);
  for (let floor = 0; floor < sobrado.floors; floor += 1) {
    const y = ROOF + CORNICE + floor * FLOOR;
    const ground = floor === sobrado.floors - 1;
    for (const x of xs) {
      if (ground) {
        paintDoor(front, x, y + 1, sobrado.door);
      } else {
        paintWindow(front, x, y + 1);
      }
    }
    if (!ground) {
      rect(front, 0, y + FLOOR - 1, width, 1, COLORS.w);
    }
  }
  rect(front, 0, 0, 1, height, INK);
  rect(front, width - 1, 0, 1, height, INK);
  rect(front, 0, 0, width, 1, INK);
  rect(front, 0, height - 1, width, 1, INK);
  return front;
}

/** A row of sobrados sharing walls, their doors on the same ground. */
function casario(sobrados: Sobrado[]) {
  const fronts = sobrados.map(paintSobrado);
  const width = fronts.reduce((sum, front) => sum + front.w - 1, 1);
  const height = Math.max(...fronts.map((front) => front.h));
  const row = blank(width, height);
  let x = 0;
  for (const front of fronts) {
    paste(row, front, x, height - front.h);
    x += front.w - 1;
  }
  return row;
}

const WALLS = {
  rosa: COLORS.m,
  amarelo: COLORS.Y,
  turquesa: COLORS.c,
  azul: COLORS.B,
  verde: "#8ec45a",
  laranja: COLORS.O,
  lilas: "#b79be0",
  vermelho: "#e2604f",
} as const;

const house = (
  wall: keyof typeof WALLS,
  width: number,
  floors: 2 | 3,
  door: string,
  gable = false
): Sobrado => ({ wall: WALLS[wall], width, floors, door, gable });

/** Rows of sobrados, for the corners and the sides of the square. */
export const CASARIOS = {
  cais: casario([
    house("azul", 23, 2, COLORS.N),
    house("amarelo", 26, 3, COLORS.v, true),
    house("rosa", 23, 2, COLORS.b),
    house("turquesa", 25, 3, COLORS.N, true),
  ]),
  alfandega: casario([
    house("laranja", 25, 3, COLORS.b, true),
    house("verde", 23, 2, COLORS.N),
    house("lilas", 26, 3, COLORS.n, true),
    house("vermelho", 23, 2, COLORS.v),
  ]),
  bomJesus: casario([
    house("turquesa", 23, 2, COLORS.n),
    house("rosa", 26, 3, COLORS.N, true),
    house("amarelo", 23, 2, COLORS.b),
  ]),
  aurora: casario([
    house("lilas", 23, 2, COLORS.N),
    house("azul", 26, 3, COLORS.n, true),
    house("laranja", 23, 2, COLORS.v),
  ]),
};

/** Confetti on the paving: a few pixels, always the same ones. */
export function confetti(
  area: { h: number; w: number; x: number; y: number },
  count: number
): Array<{ color: string; x: number; y: number }> {
  const pieces: Array<{ color: string; x: number; y: number }> = [];
  let seed = 20_260_823;
  const roll = () => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  for (let index = 0; index < count; index += 1) {
    pieces.push({
      x: area.x + Math.floor(roll() * area.w),
      y: area.y + Math.floor(roll() * area.h),
      color: FESTA[index % FESTA.length] ?? COLORS.R,
    });
  }
  return pieces;
}
