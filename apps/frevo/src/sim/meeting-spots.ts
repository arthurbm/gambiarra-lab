// Where the blocos gather while they compose. The telão draws a flag at each
// spot, so the simulation and the art share these coordinates: they are in
// map units, the same space as `PRACA` (160 x 90).

export interface MeetingSpot {
  id: string;
  x: number;
  y: number;
}

export const MEETING_SPOTS: readonly MeetingSpot[] = [
  { id: "ponto-1", x: 54, y: 30 },
  { id: "ponto-2", x: 106, y: 30 },
  { id: "ponto-3", x: 148, y: 44 },
  { id: "ponto-4", x: 12, y: 46 },
  { id: "ponto-5", x: 50, y: 54 },
  { id: "ponto-6", x: 110, y: 54 },
  { id: "ponto-7", x: 54, y: 78 },
  { id: "ponto-8", x: 80, y: 70 },
  { id: "ponto-9", x: 102, y: 82 },
  { id: "ponto-10", x: 148, y: 78 },
];
