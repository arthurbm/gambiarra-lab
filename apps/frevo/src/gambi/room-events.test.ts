import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { HubLlmEvent } from "../brains/metrics";
import {
  type FakeUpstream,
  startFakeUpstream,
} from "../model-host/fake-upstream";
import { type ModelHost, startModelHost } from "../model-host/host";
import { type RunningHub, startHub } from "../testing/processes";
import { until } from "../testing/until";
import { ensureRoom, listModelParticipants } from "./room";
import { type RoomEventsWatch, watchRoomLlmEvents } from "./room-events";

const ROOM_NAME = "frevo-eventos";

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let watch: RoomEventsWatch;
let roomCode: string | null = null;
const events: HubLlmEvent[] = [];
let opened = 0;

async function ask(participantId: string) {
  const response = await fetch(
    `${hub.url}/rooms/${roomCode}/v1/chat/completions`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: participantId,
        messages: [{ role: "user", content: "Oi" }],
      }),
    }
  );
  expect(response.status).toBe(200);
}

async function participant() {
  return await until(async () => {
    const [first] = await listModelParticipants(hub.url, roomCode as string);
    return first;
  }, 30_000);
}

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({ models: ["fake-a"] });
  roomCode = (await ensureRoom(hub.url, ROOM_NAME)).code;
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-a", participants: 1 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
  watch = watchRoomLlmEvents({
    hubUrl: hub.url,
    roomCode: () => roomCode,
    onEvent: (event) => events.push(event),
    onOpen: () => {
      opened += 1;
    },
    retryMs: 100,
  });
});

afterAll(async () => {
  await watch.stop();
  await host.stop();
  upstream.stop();
  await hub.stop();
});

describe("the Room's inference events", () => {
  test("arrive with the participant and the hub's metrics", async () => {
    const { id } = await participant();
    await until(() => Promise.resolve(opened > 0 || undefined));
    await ask(id);
    const event = await until(() => Promise.resolve(events[0]));
    expect(event).toMatchObject({
      type: "llm.complete",
      participantId: id,
      metrics: { inputTokens: 900, outputTokens: 80 },
    });
    expect(typeof event.metrics?.durationMs).toBe("number");
  });

  test("keep coming after the stream drops and the Room comes back under a new code", async () => {
    const before = opened;
    await hub.restart();
    roomCode = (await ensureRoom(hub.url, ROOM_NAME)).code;
    const { id } = await participant();
    await until(() => Promise.resolve(opened > before || undefined), 20_000);
    events.length = 0;
    await ask(id);
    const event = await until(() => Promise.resolve(events[0]));
    expect(event).toMatchObject({ type: "llm.complete", participantId: id });
  }, 40_000);
});
