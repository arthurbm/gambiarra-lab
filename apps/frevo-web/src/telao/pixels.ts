// A grid of art pixels, for drawings made by code. It is plain data: the
// painter turns a grid into a canvas, and a test can read it as it is.

export interface Drawing {
  /** Row by row, one colour per art pixel; null is transparent. */
  cells: Array<string | null>;
  h: number;
  w: number;
}

export type Palette = Readonly<Record<string, string>>;

export function blank(w: number, h: number, fill: string | null = null) {
  return { w, h, cells: new Array<string | null>(w * h).fill(fill) };
}

export function colorAt(drawing: Drawing, x: number, y: number) {
  if (x < 0 || y < 0 || x >= drawing.w || y >= drawing.h) {
    return null;
  }
  return drawing.cells[y * drawing.w + x] ?? null;
}

/** Paints one pixel; outside the grid it does nothing. */
export function put(
  drawing: Drawing,
  x: number,
  y: number,
  color: string | null
) {
  if (x >= 0 && y >= 0 && x < drawing.w && y < drawing.h) {
    drawing.cells[y * drawing.w + x] = color;
  }
}

export function rect(
  drawing: Drawing,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string | null
) {
  for (let row = y; row < y + h; row += 1) {
    for (let col = x; col < x + w; col += 1) {
      put(drawing, col, row, color);
    }
  }
}

/** A filled ellipse; the centre may sit between two pixels (x.5). */
export function ellipse(
  drawing: Drawing,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string
) {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x += 1) {
      if (((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) {
        put(drawing, x, y, color);
      }
    }
  }
}

/** A one pixel line between two points, ends included. */
export function line(
  drawing: Drawing,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string
) {
  const steps = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), 1);
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    put(
      drawing,
      Math.round(from.x + (to.x - from.x) * t),
      Math.round(from.y + (to.y - from.y) * t),
      color
    );
  }
}

/** Rows of letters, one per colour of the palette; any other letter is skipped. */
export function stamp(
  drawing: Drawing,
  rows: readonly string[],
  x: number,
  y: number,
  palette: Palette
) {
  for (const [dy, row] of rows.entries()) {
    for (const [dx, key] of [...row].entries()) {
      const color = palette[key];
      if (color) {
        put(drawing, x + dx, y + dy, color);
      }
    }
  }
}

/** Copies the painted pixels of another drawing, its top-left at (x, y). */
export function paste(drawing: Drawing, source: Drawing, x: number, y: number) {
  for (let row = 0; row < source.h; row += 1) {
    for (let col = 0; col < source.w; col += 1) {
      const color = colorAt(source, col, row);
      if (color) {
        put(drawing, x + col, y + row, color);
      }
    }
  }
}

const SIDES = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

/** Paints every empty pixel that touches a painted one: the pack's dark edge. */
export function outline(drawing: Drawing, color: string) {
  const edge: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < drawing.h; y += 1) {
    for (let x = 0; x < drawing.w; x += 1) {
      if (
        colorAt(drawing, x, y) === null &&
        SIDES.some(([dx, dy]) => colorAt(drawing, x + dx, y + dy) !== null)
      ) {
        edge.push({ x, y });
      }
    }
  }
  for (const { x, y } of edge) {
    put(drawing, x, y, color);
  }
}
