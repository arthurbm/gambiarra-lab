// The model host keeps model participants open in the Room. It finds the Room
// by name, joins, and joins again whenever a tunnel closes: after a hub
// restart the Room comes back under a new code, so each attempt looks it up
// again. This is the only module that holds the provider's credentials.
import { createParticipantSession, type ParticipantSession } from "gambi-sdk";
import { findRoomByName } from "../gambi/room";

export interface ModelSpec {
  /** The model id the upstream serves. */
  model: string;
  /** How many participants to keep open; each answers one request at a time. */
  participants: number;
}

export interface Upstream {
  /** Sent to the upstream only; the hub never sees them. */
  authHeaders?: Record<string, string>;
  /** Base URL without `/v1`. */
  endpoint: string;
}

export type ModelHostEvent =
  | { participantId: string; roomCode: string; type: "joined" }
  | { participantId: string; reason: string; type: "left" }
  | { error: string; participantId: string; type: "retrying" };

export interface ModelHostOptions {
  hubUrl: string;
  models: ModelSpec[];
  onEvent?: (event: ModelHostEvent) => void;
  /** Pause between attempts to join. */
  retryMs?: number;
  roomName: string;
  upstream: Upstream;
}

export interface ModelHost {
  participantIds: string[];
  /** Leaves the Room and stops joining again. */
  stop: () => Promise<void>;
}

const NOT_SLUG = /[^a-z0-9]+/g;
const EDGE_DASHES = /^-+|-+$/g;

function slug(text: string) {
  return text.toLowerCase().replace(NOT_SLUG, "-").replace(EDGE_DASHES, "");
}

export function startModelHost(options: ModelHostOptions): ModelHost {
  const retryMs = options.retryMs ?? 2000;
  const sessions = new Map<string, ParticipantSession>();
  let stopped = false;
  const wakers = new Set<() => void>();

  function pause() {
    return new Promise<void>((resolvePause) => {
      const wake = () => {
        clearTimeout(timer);
        wakers.delete(wake);
        resolvePause();
      };
      const timer = setTimeout(wake, retryMs);
      wakers.add(wake);
    });
  }

  async function keepJoined(
    participantId: string,
    spec: ModelSpec,
    index: number
  ) {
    while (!stopped) {
      try {
        // biome-ignore lint/performance/noAwaitInLoops: one participant joins, waits and joins again in sequence.
        const room = await findRoomByName(options.hubUrl, options.roomName);
        if (!room) {
          throw new Error(`no Room named "${options.roomName}" yet`);
        }
        const session = await createParticipantSession({
          authHeaders: options.upstream.authHeaders,
          endpoint: options.upstream.endpoint,
          hubUrl: options.hubUrl,
          model: spec.model,
          nickname: `${spec.model} ${index}`,
          participantId,
          roomCode: room.code,
        });
        if (stopped) {
          await session.close();
          return;
        }
        sessions.set(participantId, session);
        options.onEvent?.({
          type: "joined",
          participantId,
          roomCode: room.code,
        });
        const closed = await session.waitUntilClosed();
        sessions.delete(participantId);
        options.onEvent?.({
          type: "left",
          participantId,
          reason: closed.reason,
        });
      } catch (error) {
        options.onEvent?.({
          type: "retrying",
          participantId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (!stopped) {
        await pause();
      }
    }
  }

  const loops: Promise<void>[] = [];
  const participantIds: string[] = [];
  for (const spec of options.models) {
    for (let index = 1; index <= spec.participants; index += 1) {
      const participantId = `frevo-${slug(spec.model)}-${index}`;
      participantIds.push(participantId);
      loops.push(keepJoined(participantId, spec, index));
    }
  }

  return {
    participantIds,
    async stop() {
      stopped = true;
      for (const wake of [...wakers]) {
        wake();
      }
      await Promise.all([...sessions.values()].map((session) => session.close()));
      await Promise.all(loops);
    },
  };
}
