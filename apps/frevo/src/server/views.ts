// What the world server sends to each screen, beyond the simulation's own
// views: the phase clock on the telão and the phones, the phone's notices,
// and the host's state on the admin. The web imports these types.
import type { PlayCommand, SoundStatus, TrackStatus } from "../music/jukebox";
import {
  type DesfileView,
  desfileView,
  type PhoneDesfile,
  phoneDesfile,
} from "../sim/desfile";
import { type PhaseStatus, phaseStatus } from "../sim/phases";
import {
  type PrivateView,
  type PublicSnapshot,
  privateView,
  publicSnapshot,
  type World,
} from "../sim/world";

export type { PlayCommand, SoundStatus, TrackStatus } from "../music/jukebox";
export type {
  DesfileBloco,
  DesfileMember,
  DesfileView,
  PhoneDesfile,
} from "../sim/desfile";
export type { PhaseStatus } from "../sim/phases";

/** What the telão plays, with how long ago the host asked for it. */
export type TelaoAudio = PlayCommand & { ageMs: number };

export type TelaoSnapshot = PublicSnapshot & {
  /** The music the host last played or stopped; null before any. */
  audio?: TelaoAudio | null;
  clock: PhaseStatus;
  /** The parade and the jury, in the desfile and the final. */
  desfile: DesfileView | null;
};
export type PhoneView = PrivateView & {
  clock: PhaseStatus;
  /** The person's bloco in the desfile and the final. */
  desfile: PhoneDesfile | null;
};
/** What a phone's stream carries: its view, or why it has none. */
export type PhoneEvent =
  | PhoneView
  /** The host expelled this person; the session stays out. */
  | { expulso: true }
  /** The host restarted the dynamic; entering again gives a new boneco. */
  | { reiniciou: true };

export interface AdminBoneco {
  /** A phone has the boneco's stream open now. */
  connected: boolean;
  id: string;
  instrument: string | null;
  look: number;
  /** The model that answered last, or the one it was given. */
  model: string | null;
  name: string;
  silenced: boolean;
  simulated: boolean;
}

export interface Spending {
  ceilingUsd: number;
  /** Past the ceiling: every boneco is on autopilot. */
  exceeded: boolean;
  spentUsd: number;
}

/** The jury's section of the admin. */
export interface AdminJury {
  desfile: DesfileView | null;
  /** The last command sent to the telão. */
  playing: PlayCommand | null;
  sound: SoundStatus;
  /** The music of each bloco the host chose, by bloco id. */
  tracks: Record<string, TrackStatus>;
}

export interface AdminState {
  bonecos: AdminBoneco[];
  clock: PhaseStatus;
  jury: AdminJury;
  people: {
    /** Phones of real people with the stream open now. */
    connected: number;
    /** Real people who entered since the last restart. */
    joined: number;
    simulated: number;
  };
  /** Estimated inference spending; null until the scheduler reports it. */
  spending: Spending | null;
}

export function telaoSnapshot(world: World): TelaoSnapshot {
  return {
    ...publicSnapshot(world),
    clock: phaseStatus(world),
    desfile: desfileView(world),
  };
}

/** One person's phone, by session; null for a session the world does not know. */
export function phoneView(world: World, sessionId: string): PhoneView | null {
  const view = privateView(world, sessionId);
  return view
    ? {
        ...view,
        clock: phaseStatus(world),
        desfile: phoneDesfile(world, view.boneco.id),
      }
    : null;
}

export function adminState(
  world: World,
  input: {
    connected: (sessionId: string) => boolean;
    isSimulated: (sessionId: string) => boolean;
    jury?: Omit<AdminJury, "desfile">;
    spending: Spending | null;
  }
): AdminState {
  const bonecos = world.bonecos.map((boneco): AdminBoneco => {
    const session = boneco.sessionId;
    return {
      id: boneco.id,
      name: boneco.name,
      look: boneco.look,
      instrument: boneco.instrument,
      model: boneco.model ?? boneco.assignedModel,
      silenced: boneco.silenced,
      simulated: session !== null && input.isSimulated(session),
      connected: session !== null && input.connected(session),
    };
  });
  const real = world.bonecos.filter(
    (boneco) =>
      boneco.sessionId !== null && !input.isSimulated(boneco.sessionId)
  );
  return {
    clock: phaseStatus(world),
    people: {
      joined: real.length,
      connected: bonecos.filter((boneco) => boneco.connected).length,
      simulated: bonecos.filter((boneco) => boneco.simulated).length,
    },
    bonecos,
    spending: input.spending,
    jury: {
      desfile: desfileView(world),
      playing: input.jury?.playing ?? null,
      sound: input.jury?.sound ?? { enabled: false, playing: null },
      tracks: input.jury?.tracks ?? {},
    },
  };
}
