// The Room as this experience needs it: found or created by name on the
// management plane, and called on the inference plane. Room codes are
// generated and do not survive a hub restart, so the name is the stable key.
import type {
  ChatCompletionBody,
  Inference,
  RoomParticipant,
} from "../brains/scheduler";

const MANAGEMENT_TIMEOUT_MS = 5000;
const TRAILING_SLASH = /\/$/;

interface RoomSummary {
  code: string;
  createdAt: number;
  name: string;
}

interface ParticipantSummary {
  connection?: { connected?: boolean };
  endpoint?: string;
  harness?: unknown;
  id: string;
  model: string;
  status: "busy" | "offline" | "online";
}

/** A management or inference call the hub answered with an error status. */
export class HubError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function management<T>(
  hubUrl: string,
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${hubUrl.replace(TRAILING_SLASH, "")}${path}`, {
    ...init,
    signal: AbortSignal.timeout(MANAGEMENT_TIMEOUT_MS),
  });
  const body = (await response.json().catch(() => ({}))) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || body.data === undefined) {
    throw new HubError(
      body.error?.message ?? `${path} answered ${response.status}`,
      response.status
    );
  }
  return body.data;
}

export async function hubHealthy(hubUrl: string): Promise<boolean> {
  try {
    await management(hubUrl, "/v1/health");
    return true;
  } catch {
    return false;
  }
}

/** The oldest Room with this name, so every process picks the same one. */
export async function findRoomByName(
  hubUrl: string,
  name: string
): Promise<RoomSummary | undefined> {
  const rooms = await management<RoomSummary[]>(hubUrl, "/v1/rooms");
  return rooms
    .filter((room) => room.name === name)
    .sort((a, b) => a.createdAt - b.createdAt)[0];
}

/** Reuses the Room with this name, or creates it. */
export async function ensureRoom(
  hubUrl: string,
  name: string
): Promise<{ code: string; created: boolean }> {
  const existing = await findRoomByName(hubUrl, name);
  if (existing) {
    return { code: existing.code, created: false };
  }
  const created = await management<{ room: RoomSummary }>(hubUrl, "/v1/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return { code: created.room.code, created: true };
}

/** Model participants with an open tunnel; harness participants are left out. */
export async function listModelParticipants(
  hubUrl: string,
  roomCode: string
): Promise<RoomParticipant[]> {
  const participants = await management<ParticipantSummary[]>(
    hubUrl,
    `/v1/rooms/${encodeURIComponent(roomCode)}/participants`
  );
  return participants
    .filter(
      (participant) =>
        !participant.harness &&
        participant.connection?.connected &&
        participant.status !== "offline"
    )
    .map((participant) => ({ id: participant.id, model: participant.model }));
}

/** chat/completions on the Room's inference plane; `body.model` is the participant id. */
export function roomInference(
  hubUrl: string,
  roomCode: () => string
): Inference {
  return async (
    _participantId: string,
    body: ChatCompletionBody,
    signal: AbortSignal
  ) => {
    const response = await fetch(
      `${hubUrl.replace(TRAILING_SLASH, "")}/rooms/${encodeURIComponent(roomCode())}/v1/chat/completions`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      }
    );
    if (!response.ok) {
      throw new HubError(
        `chat/completions answered ${response.status}: ${(await response.text()).slice(0, 300)}`,
        response.status
      );
    }
    return await response.json();
  };
}
