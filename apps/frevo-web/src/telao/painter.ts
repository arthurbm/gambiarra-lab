// Canvas drawing for the telão. Every art pixel becomes `fit.scale` device
// pixels and every destination is rounded to a whole device pixel, so the art
// stays sharp; a boneco still moves one device pixel at a time.
import type { Facing } from "@gambiarra-lab/frevo/snapshot";
import {
  CHARACTERS,
  characterSheetUrl,
  FACING_COLUMN,
  FRAME,
  INSTRUMENTS,
  type Instrument,
} from "../art/characters";
import { ICON_SIZE, iconPixels } from "../art/instrument-icons";
import type { WorldFit } from "./scale";
import {
  DECALS,
  groundAt,
  PROPS,
  type Prop,
  type Region,
  SHEETS,
  type Sheet,
  SPOTS,
  TILE,
} from "./scene";

const UI = {
  shadow: "/art/ui/shadow.png",
  thinking: "/art/ui/thinking.png",
};

export interface Figure {
  facing: Facing;
  id: string;
  instrument: Instrument | null;
  look: number;
  name: string;
  thinking: boolean;
  /** 0 to 3 while walking, 0 standing. */
  walkFrame: number;
  /** Feet, in art pixels. */
  x: number;
  y: number;
}

export interface Art {
  icons: Map<Instrument, HTMLCanvasElement>;
  images: Map<string, HTMLImageElement>;
  /** The "thinking" bubbles with a dark outline, so they read on light ground. */
  thinking: HTMLCanvasElement;
}

function loadImage(url: string): Promise<[string, HTMLImageElement]> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve([url, image]);
    image.onerror = () => reject(new Error(`could not load ${url}`));
    image.src = url;
  });
}

function paintIcon(instrument: Instrument) {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  for (const pixel of iconPixels(instrument)) {
    if (ctx) {
      ctx.fillStyle = pixel.color;
      ctx.fillRect(pixel.x, pixel.y, 1, 1);
    }
  }
  return canvas;
}

const OUTLINE = "#1b1035";
/** thinking.png: empty, one, two and three dots, 20 x 16 each. */
const THINK_FRAMES = 4;
const THINK_W = 20;
const THINK_H = 16;

/** Each frame gets a 1 px dark outline, in a cell 2 px larger. */
function outline(image: HTMLImageElement | undefined) {
  const canvas = document.createElement("canvas");
  canvas.width = THINK_FRAMES * (THINK_W + 2);
  canvas.height = THINK_H + 2;
  const ctx = canvas.getContext("2d");
  if (!(ctx && image)) {
    return canvas;
  }
  const silhouette = document.createElement("canvas");
  silhouette.width = image.width;
  silhouette.height = image.height;
  const dark = silhouette.getContext("2d");
  if (dark) {
    dark.drawImage(image, 0, 0);
    dark.globalCompositeOperation = "source-in";
    dark.fillStyle = OUTLINE;
    dark.fillRect(0, 0, image.width, image.height);
  }
  for (let frame = 0; frame < THINK_FRAMES; frame += 1) {
    for (const [dx, dy] of [
      [0, 1],
      [2, 1],
      [1, 0],
      [1, 2],
    ] as const) {
      ctx.drawImage(
        silhouette,
        frame * THINK_W,
        0,
        THINK_W,
        THINK_H,
        frame * (THINK_W + 2) + dx,
        dy,
        THINK_W,
        THINK_H
      );
    }
    ctx.drawImage(
      image,
      frame * THINK_W,
      0,
      THINK_W,
      THINK_H,
      frame * (THINK_W + 2) + 1,
      1,
      THINK_W,
      THINK_H
    );
  }
  return canvas;
}

export async function loadArt(): Promise<Art> {
  const urls = [
    ...Object.values(SHEETS),
    ...Object.values(UI),
    ...CHARACTERS.map((_, look) => characterSheetUrl(look)),
  ];
  const images = new Map(await Promise.all(urls.map(loadImage)));
  const icons = new Map(
    INSTRUMENTS.map((instrument) => [instrument, paintIcon(instrument)])
  );
  return { images, icons, thinking: outline(images.get(UI.thinking)) };
}

/** Draws a piece of an image with its top-left at art pixel (x, y). */
function blit(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  source: CanvasImageSource | undefined,
  sx: number,
  sy: number,
  w: number,
  h: number,
  x: number,
  y: number
) {
  if (!source) {
    return;
  }
  ctx.drawImage(
    source,
    sx,
    sy,
    w,
    h,
    Math.round(fit.originX + x * fit.scale),
    Math.round(fit.originY + y * fit.scale),
    w * fit.scale,
    h * fit.scale
  );
}

function blitRegion(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  art: Art,
  r: Region,
  x: number,
  y: number,
  frame = 0
) {
  const w = r.w * TILE;
  blit(
    ctx,
    fit,
    art.images.get(SHEETS[r.sheet as Sheet]),
    r.col * TILE + frame * w,
    r.row * TILE,
    w,
    r.h * TILE,
    x,
    y
  );
}

function sharp(ctx: CanvasRenderingContext2D) {
  ctx.imageSmoothingEnabled = false;
}

/** The ground of the whole canvas, painted once per size. */
export function paintGround(art: Art, fit: WorldFit): HTMLCanvasElement {
  const layer = document.createElement("canvas");
  layer.width = fit.canvasWidth;
  layer.height = fit.canvasHeight;
  const ctx = layer.getContext("2d");
  if (!ctx) {
    return layer;
  }
  sharp(ctx);
  const span = TILE * fit.scale;
  const col0 = Math.floor(-fit.originX / span);
  const row0 = Math.floor(-fit.originY / span);
  const col1 = Math.ceil((fit.canvasWidth - fit.originX) / span);
  const row1 = Math.ceil((fit.canvasHeight - fit.originY) / span);
  for (let row = row0; row <= row1; row += 1) {
    for (let col = col0; col <= col1; col += 1) {
      blitRegion(ctx, fit, art, groundAt(col, row), col * TILE, row * TILE);
    }
  }
  for (const decal of DECALS) {
    blitRegion(ctx, fit, art, decal.region, decal.x, decal.y);
  }
  ctx.fillStyle = SPOT_RING;
  for (const spot of SPOTS) {
    for (const pixel of SPOT_RING_PIXELS) {
      ctx.fillRect(
        fit.originX + (spot.x + pixel.x) * fit.scale,
        fit.originY + (spot.y + pixel.y) * fit.scale,
        fit.scale,
        fit.scale
      );
    }
  }
  return layer;
}

const SPOT_RING = "rgb(120 62 30 / 55%)";
/** A pixel ellipse, two pixels thick, around each meeting spot. */
const SPOT_RING_PIXELS = ellipse(13, 7);

function ellipse(rx: number, ry: number) {
  const pixels: Array<{ x: number; y: number }> = [];
  for (let y = -ry - 1; y <= ry + 1; y += 1) {
    for (let x = -rx - 1; x <= rx + 1; x += 1) {
      const d = (x / rx) ** 2 + (y / ry) ** 2;
      if (d <= 1.15 && d >= 0.62) {
        pixels.push({ x, y });
      }
    }
  }
  return pixels;
}

const FLAG_FPS = 6;
const THINK_FPS = 3;

function drawProp(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  art: Art,
  prop: Prop,
  timeMs: number
) {
  const frame = prop.frames
    ? Math.floor((timeMs * FLAG_FPS) / 1000) % prop.frames
    : 0;
  blitRegion(ctx, fit, art, prop.region, prop.x, prop.y, frame);
}

function drawFigure(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  art: Art,
  figure: Figure
) {
  const left = Math.round(figure.x) - FRAME / 2;
  const top = Math.round(figure.y) - FRAME + 1;
  const icon = figure.instrument ? art.icons.get(figure.instrument) : undefined;
  // Carried on the right hand side, bobbing with the step.
  const bob = figure.walkFrame % 2;
  const drawIcon = () =>
    blit(ctx, fit, icon, 0, 0, ICON_SIZE, ICON_SIZE, left + 8, top + 2 - bob);
  if (figure.facing === "up") {
    drawIcon();
  }
  blit(
    ctx,
    fit,
    art.images.get(characterSheetUrl(figure.look)),
    FACING_COLUMN[figure.facing] * FRAME,
    figure.walkFrame * FRAME,
    FRAME,
    FRAME,
    left,
    top
  );
  if (figure.facing !== "up") {
    drawIcon();
  }
}

interface Label {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

const crosses = (a: Label, b: Label) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Names under the feet; a name that would cover another moves down a line. */
function drawNames(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  figures: Figure[],
  fontPx: number
) {
  const placed: Label[] = [];
  const lineHeight = Math.round(fontPx * 1.15);
  for (const figure of [...figures].sort((a, b) => a.y - b.y)) {
    const x = Math.round(fit.originX + figure.x * fit.scale);
    const half = ctx.measureText(figure.name).width / 2 + 2;
    let y = Math.round(fit.originY + (figure.y + 2) * fit.scale);
    for (let tries = 0; tries < 2; tries += 1) {
      const box = {
        left: x - half,
        right: x + half,
        top: y,
        bottom: y + lineHeight,
      };
      if (!placed.some((other) => crosses(box, other))) {
        break;
      }
      y += lineHeight;
    }
    placed.push({
      left: x - half,
      right: x + half,
      top: y,
      bottom: y + lineHeight,
    });
    ctx.strokeText(figure.name, x, y);
    ctx.fillText(figure.name, x, y);
  }
}

/** One frame: ground, then props and bonecos sorted by depth, then signs. */
export function paintFrame(
  ctx: CanvasRenderingContext2D,
  fit: WorldFit,
  art: Art,
  ground: HTMLCanvasElement,
  figures: Figure[],
  timeMs: number
) {
  sharp(ctx);
  ctx.drawImage(ground, 0, 0);
  const shadow = art.images.get(UI.shadow);
  for (const figure of figures) {
    blit(
      ctx,
      fit,
      shadow,
      0,
      0,
      12,
      7,
      Math.round(figure.x) - 6,
      Math.round(figure.y) - 4
    );
  }
  const layers = [
    ...PROPS.map((prop) => ({
      y: prop.baseY,
      draw: () => drawProp(ctx, fit, art, prop, timeMs),
    })),
    ...figures.map((figure) => ({
      y: figure.y,
      draw: () => drawFigure(ctx, fit, art, figure),
    })),
  ].sort((a, b) => a.y - b.y);
  for (const layer of layers) {
    layer.draw();
  }

  const fontPx = Math.max(11, Math.round(fit.scale * 3.6));
  ctx.font = `700 ${fontPx}px system-ui, "Segoe UI", Roboto, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, fit.scale);
  ctx.strokeStyle = "#1b1035";
  ctx.fillStyle = "#fff8e7";
  drawNames(ctx, fit, figures, fontPx);

  const thinkFrame = 1 + (Math.floor((timeMs * THINK_FPS) / 1000) % 3);
  const bubbleScale = Math.max(2, Math.round(fit.scale * 0.6));
  for (const figure of figures) {
    const x = Math.round(figure.x);
    const head = Math.round(figure.y) - FRAME;
    if (figure.thinking) {
      // Smaller than the world, still whole pixels: a crowd thinking at once
      // must not hide itself.
      const w = (THINK_W + 2) * bubbleScale;
      const h = (THINK_H + 2) * bubbleScale;
      ctx.drawImage(
        art.thinking,
        thinkFrame * (THINK_W + 2),
        0,
        THINK_W + 2,
        THINK_H + 2,
        Math.round(fit.originX + x * fit.scale - w / 2),
        Math.round(fit.originY + (head + 2) * fit.scale - h),
        w,
        h
      );
    }
  }
}
