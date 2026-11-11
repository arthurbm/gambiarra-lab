import { describe, expect, test } from "bun:test";
import { fitWorld } from "./scale";

const WORLD = { width: 320, height: 180 };

describe("fitting the world on the stage", () => {
  test("a 1080p projector draws each art pixel as 4 screen pixels", () => {
    const fit = fitWorld({ ...WORLD, stageWidth: 1500, stageHeight: 1080 });
    expect(fit.scale).toBe(4);
    expect(fit.canvasWidth).toBe(1500);
    expect(fit.canvasHeight).toBe(1080);
    // Centred, on whole device pixels: (1500 - 1280) / 2 and (1080 - 720) / 2.
    expect(fit.originX).toBe(110);
    expect(fit.originY).toBe(180);
  });

  test("a 720p projector gets 3, never a fraction", () => {
    const fit = fitWorld({ ...WORLD, stageWidth: 980, stageHeight: 720 });
    expect(fit.scale).toBe(3);
    expect(fit.originX).toBe(10);
    expect(fit.originY).toBe(90);
  });

  test("counts device pixels on a high-density screen", () => {
    const fit = fitWorld({
      ...WORLD,
      stageWidth: 750,
      stageHeight: 540,
      devicePixelRatio: 2,
    });
    expect(fit.scale).toBe(4);
    expect(fit.canvasWidth).toBe(1500);
    expect(fit.cssPerDevicePixel).toBe(0.5);
  });

  test("an odd remainder rounds the origin down", () => {
    const fit = fitWorld({ ...WORLD, stageWidth: 961, stageHeight: 541 });
    expect(fit.scale).toBe(3);
    expect(fit.originX).toBe(0);
    expect(fit.originY).toBe(0);
  });

  test("a stage smaller than the world still draws at 1", () => {
    const fit = fitWorld({ ...WORLD, stageWidth: 200, stageHeight: 100 });
    expect(fit.scale).toBe(1);
  });
});
