import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  type ChatCompletionBody,
  createBrainScheduler,
} from "../brains/scheduler";
import {
  ensureRoom,
  listModelParticipants,
  roomInference,
} from "../gambi/room";
import { PRACA } from "../sim/world";
import { type RunningHub, startHub } from "../testing/processes";
import { until } from "../testing/until";
import { type FakeUpstream, startFakeUpstream } from "./fake-upstream";
import { type ModelHost, startModelHost } from "./host";

const ROOM_NAME = "bloco-de-frevo-teste";
const PLACE_IDS = PRACA.places.map((place) => place.id);

let hub: RunningHub;
let upstream: FakeUpstream;
let host: ModelHost;
let roomCode = "";
const received: Record<string, unknown>[] = [];

function connected() {
  return until(async () => {
    const participants = await listModelParticipants(hub.url, roomCode);
    return participants.length === host.participantIds.length
      ? participants
      : undefined;
  }, 30_000);
}

async function decideThroughTheRoom(requestId: string) {
  const scheduler = createBrainScheduler({
    infer: roomInference(hub.url, () => roomCode),
  });
  scheduler.setParticipants(await connected());
  scheduler.submit({
    id: requestId,
    boneco: { id: "boneco-1", name: "Capiba" },
    deadlineMs: 12_000,
    placeId: null,
    places: PRACA.places,
  });
  return await until(() => Promise.resolve(scheduler.drain()[0]));
}

beforeAll(async () => {
  hub = await startHub();
  upstream = startFakeUpstream({
    models: ["fake-frevo"],
    onRequest: (body) => received.push(body),
  });
  roomCode = (await ensureRoom(hub.url, ROOM_NAME)).code;
  host = startModelHost({
    hubUrl: hub.url,
    roomName: ROOM_NAME,
    models: [{ model: "fake-frevo", participants: 2 }],
    upstream: { endpoint: upstream.endpoint },
    retryMs: 100,
  });
});

afterAll(async () => {
  await host.stop();
  upstream.stop();
  await hub.stop();
});

describe("the model host in a Room", () => {
  test("finds the Room by name and joins with its model participants", async () => {
    const participants = await connected();
    expect(participants.map((participant) => participant.id).sort()).toEqual(
      [...host.participantIds].sort()
    );
    expect(participants.map((participant) => participant.model)).toEqual([
      "fake-frevo",
      "fake-frevo",
    ]);
  });

  test("a tool call crosses the hub end to end", async () => {
    const result = await decideThroughTheRoom("boneco-1#1");

    expect(result.ok).toBe(true);
    if (!result.ok || result.action.type !== "walk") {
      throw new Error("expected a walk decided by the model");
    }
    expect(result.model).toBe("fake-frevo");
    expect(PLACE_IDS).toContain(result.action.placeId);
    expect(result.action.speech.length).toBeGreaterThan(0);
  });

  test("tools, tool_choice, max_tokens and reasoning reach the upstream; the model is rewritten", async () => {
    const [participant] = await connected();
    const infer = roomInference(hub.url, () => roomCode);
    const tool = {
      type: "function" as const,
      function: {
        name: "agir",
        description: "Decide.",
        parameters: {
          type: "object",
          required: ["lugar"],
          properties: { lugar: { type: "string", enum: ["fonte"] } },
        },
      },
    };
    const body = {
      model: participant?.id as string,
      stream: false,
      max_tokens: 77,
      messages: [{ role: "user", content: "Para onde?" }],
      tools: [tool],
      tool_choice: { type: "function", function: { name: "agir" } },
      reasoning: { effort: "minimal" },
    } as unknown as ChatCompletionBody;

    received.length = 0;
    const completion = (await infer(
      body.model,
      body,
      AbortSignal.timeout(10_000)
    )) as {
      choices: {
        message: { tool_calls: { function: { arguments: string } }[] };
      }[];
    };

    expect(
      JSON.parse(
        completion.choices[0]?.message.tool_calls[0]?.function
          .arguments as string
      )
    ).toEqual({ lugar: "fonte" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      model: "fake-frevo",
      stream: false,
      max_tokens: 77,
      tools: [tool],
      tool_choice: { type: "function", function: { name: "agir" } },
      reasoning: { effort: "minimal" },
    });
  });

  // The hub forgets the participant; the session notices on its next
  // heartbeat (every 10s) and the host joins again.
  test("joins again when the hub drops its participant", async () => {
    const [participant] = await connected();
    const removed = await fetch(
      `${hub.url}/v1/rooms/${roomCode}/participants/${participant?.id}`,
      { method: "DELETE" }
    );
    expect(removed.status).toBe(200);

    const back = await connected();
    expect(back.map((entry) => entry.id)).toContain(participant?.id as string);
    expect((await decideThroughTheRoom("boneco-1#2")).ok).toBe(true);
  }, 40_000);

  test("joins the Room of the same name again after the hub restarts", async () => {
    const previous = roomCode;
    await hub.restart();
    const room = await ensureRoom(hub.url, ROOM_NAME);
    roomCode = room.code;
    expect(room.created).toBe(true);
    expect(roomCode).not.toBe(previous);

    expect(await connected()).toHaveLength(2);
    expect((await decideThroughTheRoom("boneco-1#3")).ok).toBe(true);
  }, 30_000);
});

describe("a Room by name", () => {
  test("is created once and reused after that", async () => {
    const first = await ensureRoom(hub.url, "sala-reaproveitada");
    const second = await ensureRoom(hub.url, "sala-reaproveitada");
    expect(first.created).toBe(true);
    expect(second).toEqual({ code: first.code, created: false });
  });
});
