import { describe, expect, test } from "bun:test";
import { MEETING_SPOTS } from "@gambiarra-lab/frevo/meeting-spots";
import { PRACA } from "@gambiarra-lab/frevo/snapshot";
import { REEF, SEA, SHORE, STREET, TORRE } from "./recife";
import {
  groundAt,
  isDrawing,
  type Piece,
  PROPS,
  PX_PER_UNIT,
  pieceSize,
  REGIONS,
  SCENERY_ABOVE,
} from "./scene";

const placeAt = (id: string) => {
  const place = PRACA.places.find((candidate) => candidate.id === id);
  return { x: (place?.x ?? 0) * PX_PER_UNIT, y: (place?.y ?? 0) * PX_PER_UNIT };
};

const among = (tiles: readonly Piece[], piece: Piece) => tiles.includes(piece);

describe("the Marco Zero on the telão", () => {
  test("the quay, the reef and the open sea lie above the square", () => {
    for (const col of [-6, 0, 9, 25]) {
      expect(among(SHORE, groundAt(col, 0))).toBe(true);
      expect(among(REEF, groundAt(col, -1))).toBe(true);
      expect(among(SEA[0], groundAt(col, -2))).toBe(true);
      expect(among(SEA.at(-1) ?? [], groundAt(col, -9))).toBe(true);
    }
  });

  test("the square is paved and has streets around it", () => {
    expect(groundAt(9, 5)).toBe(REGIONS.cobble);
    expect(groundAt(1, 1)).toBe(REGIONS.cobbleNW);
    expect(groundAt(18, 10)).toBe(REGIONS.cobbleSE);
    for (const [col, row] of [
      [0, 5],
      [19, 5],
      [9, 11],
      [-8, 14],
    ] as const) {
      expect(groundAt(col, row)).toBe(STREET);
    }
  });

  test("the Torre de Cristal stands in line with the Marco Zero", () => {
    const tower = PROPS.find((prop) => prop.piece === TORRE);
    const marcoZero = placeAt("marco-zero");
    expect(tower).toBeDefined();
    // Its middle column of pixels is the one the compass rose is centred on.
    expect((tower?.x ?? 0) + (TORRE.w - 1) / 2).toBe(marcoZero.x);
    // Beyond the walkway, which starts where the bonecos wait at the "ponte".
    expect(tower?.baseY ?? 0).toBeLessThan(placeAt("ponte").y);
  });

  test("the telão keeps everything above the world in view", () => {
    const above = PROPS.filter((prop) => prop.baseY <= 1);
    expect(above.length).toBeGreaterThan(5);
    for (const prop of above) {
      expect(-prop.y).toBeLessThanOrEqual(SCENERY_ABOVE);
    }
  });

  test("no drawing stands over a place or a meeting spot", () => {
    const points = [
      ...PRACA.places.map((place) => placeAt(place.id)),
      ...MEETING_SPOTS.map((spot) => ({
        x: spot.x * PX_PER_UNIT,
        y: spot.y * PX_PER_UNIT,
      })),
    ];
    for (const prop of PROPS.filter((one) => isDrawing(one.piece))) {
      const { w } = pieceSize(prop.piece);
      const covered = points.filter(
        (point) =>
          point.x >= prop.x &&
          point.x <= prop.x + w &&
          point.y >= prop.y &&
          point.y <= prop.baseY
      );
      expect(covered).toEqual([]);
    }
  });
});
