// Pixel art stays sharp only when every art pixel becomes a whole number of
// screen pixels. The canvas covers the whole stage; the world sits centred in
// it at the largest whole scale that fits, and the rest is scenery.

export interface WorldFit {
  canvasHeight: number;
  /** Canvas backing store, in device pixels. */
  canvasWidth: number;
  /** Multiply device pixels by this to get CSS pixels. */
  cssPerDevicePixel: number;
  /** Where the world's top-left corner lands, in device pixels. */
  originX: number;
  originY: number;
  /** Device pixels per art pixel, always a whole number. */
  scale: number;
}

export function fitWorld(options: {
  devicePixelRatio?: number;
  /** Stage size in CSS pixels. */
  stageHeight: number;
  stageWidth: number;
  /** World size in art pixels. */
  height: number;
  width: number;
}): WorldFit {
  const ratio = options.devicePixelRatio || 1;
  const canvasWidth = Math.max(1, Math.floor(options.stageWidth * ratio));
  const canvasHeight = Math.max(1, Math.floor(options.stageHeight * ratio));
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(canvasWidth / options.width, canvasHeight / options.height)
    )
  );
  return {
    scale,
    canvasWidth,
    canvasHeight,
    originX: Math.floor((canvasWidth - options.width * scale) / 2),
    originY: Math.floor((canvasHeight - options.height * scale) / 2),
    cssPerDevicePixel: 1 / ratio,
  };
}
