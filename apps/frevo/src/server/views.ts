// What the world server sends to each screen, beyond the simulation's own
// views: the phase clock on the telão and the phones, the phone's notices,
// and the host's state on the admin. The web imports these types.
import { type PhaseStatus, phaseStatus } from "../sim/phases";
import {
  type PrivateView,
  type PublicSnapshot,
  publicSnapshot,
  type World,
} from "../sim/world";

export type { PhaseStatus } from "../sim/phases";

export type TelaoSnapshot = PublicSnapshot & { clock: PhaseStatus };
export type PhoneView = PrivateView & { clock: PhaseStatus };
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
  spentUsd: number;
}

export interface AdminState {
  bonecos: AdminBoneco[];
  clock: PhaseStatus;
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
  return { ...publicSnapshot(world), clock: phaseStatus(world) };
}

export function adminState(
  world: World,
  input: {
    connected: (sessionId: string) => boolean;
    isSimulated: (sessionId: string) => boolean;
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
  };
}
