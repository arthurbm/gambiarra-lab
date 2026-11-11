import { describe, expect, test } from "bun:test";
import { HubError } from "../gambi/room";
import type { BrainResult, DecisionRequest } from "../sim/world";
import { PRACA } from "../sim/world";
import { fakeClock } from "../testing/clock";
import {
  type BrainSchedulerOptions,
  type ChatCompletionBody,
  createBrainScheduler,
  type RoomParticipant,
} from "./scheduler";

function request(id: string, model: string | null = null): DecisionRequest {
  return {
    id,
    boneco: { id: id.split("#")[0] as string, name: "Capiba" },
    deadlineMs: 12_000,
    model,
    placeId: null,
    places: PRACA.places,
  };
}

/** A chat completion that calls the forced tool with `args`. */
function toolCall(body: ChatCompletionBody, args: unknown, usage?: unknown) {
  return {
    choices: [
      {
        finish_reason: "tool_calls",
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_1",
              type: "function",
              function: {
                name: body.tools[0]?.function.name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
    usage,
  };
}

const WALK = { acao: "andar", lugar: "fonte", fala: "Vou ver a fonte!" };

const plainText = {
  choices: [
    {
      finish_reason: "stop",
      message: { role: "assistant", content: "Acho que vou até a fonte." },
    },
  ],
};

interface Call {
  body: ChatCompletionBody;
  fail: (error: unknown) => void;
  participantId: string;
  reply: (completion: unknown) => void;
  signal: AbortSignal;
}

/** A Room whose answers the test gives by hand, on a clock the test moves. */
function room(
  participants: RoomParticipant[],
  options: Partial<BrainSchedulerOptions> = {}
) {
  const time = fakeClock();
  const calls: Call[] = [];
  const open = new Set<string>();
  let overlaps = 0;
  const scheduler = createBrainScheduler({
    clock: time.clock,
    infer: (participantId, body, signal) => {
      if (open.has(participantId)) {
        overlaps += 1;
      }
      open.add(participantId);
      return new Promise((resolve, reject) => {
        calls.push({
          participantId,
          body,
          signal,
          reply: (completion) => {
            open.delete(participantId);
            resolve(completion);
          },
          fail: (error) => {
            open.delete(participantId);
            reject(error);
          },
        });
      });
    },
    ...options,
  });
  scheduler.setParticipants(participants);
  const results: BrainResult[] = [];
  return {
    ...time,
    calls,
    scheduler,
    overlaps: () => overlaps,
    asked: () => calls.map((call) => call.participantId),
    /** Answers the oldest unanswered call to `participantId`. */
    async answer(participantId: string, completion?: unknown) {
      const index = calls.findIndex(
        (call) =>
          call.participantId === participantId &&
          !(call as { done?: boolean }).done
      );
      const call = calls[index];
      if (!call) {
        throw new Error(`no open call to ${participantId}`);
      }
      (call as { done?: boolean }).done = true;
      call.reply(completion ?? toolCall(call.body, WALK));
      await time.flush();
    },
    async refuse(participantId: string, error: unknown) {
      const call = calls.find(
        (entry) =>
          entry.participantId === participantId &&
          !(entry as { done?: boolean }).done
      );
      if (!call) {
        throw new Error(`no open call to ${participantId}`);
      }
      (call as { done?: boolean }).done = true;
      call.fail(error);
      await time.flush();
    },
    results() {
      results.push(...scheduler.drain());
      return results;
    },
  };
}

const A1 = { id: "frevo-a-1", model: "modelo-a" };
const A2 = { id: "frevo-a-2", model: "modelo-a" };
const B1 = { id: "frevo-b-1", model: "modelo-b" };

describe("the brain scheduler", () => {
  test("asks a free participant of the boneco's model, forcing one tool", async () => {
    const r = room([A1, B1]);
    r.scheduler.submit(request("boneco-1#1", "modelo-b"));
    await r.flush();

    expect(r.asked()).toEqual(["frevo-b-1"]);
    const [call] = r.calls as [Call];
    expect(call.body.model).toBe("frevo-b-1");
    expect(call.body.stream).toBe(false);
    expect(call.body.max_tokens).toBe(400);
    expect(call.body.tools).toHaveLength(1);
    expect(call.body.tool_choice).toBe("required");

    await r.answer("frevo-b-1");
    expect(r.results()).toEqual([
      {
        requestId: "boneco-1#1",
        ok: true,
        action: { type: "walk", placeId: "fonte", speech: "Vou ver a fonte!" },
        model: "modelo-b",
      },
    ]);
  });

  test("never sends a second request to a participant that is still answering", async () => {
    const r = room([A1, A2]);
    for (let index = 1; index <= 6; index += 1) {
      r.scheduler.submit(request(`boneco-${index}#1`, "modelo-a"));
    }
    await r.flush();
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-2"]);

    await r.answer("frevo-a-1");
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-2", "frevo-a-1"]);
    for (const id of ["frevo-a-2", "frevo-a-1", "frevo-a-2", "frevo-a-1"]) {
      // biome-ignore lint/performance/noAwaitInLoops: answers come one by one.
      await r.answer(id);
    }
    await r.answer("frevo-a-2");
    expect(r.results().filter((result) => result.ok)).toHaveLength(6);
    expect(r.overlaps()).toBe(0);
  });

  test("waits a little for the boneco's model, then takes any free participant", async () => {
    const r = room([A1, B1], { fallbackMs: 1500 });
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    r.scheduler.submit(request("boneco-2#1", "modelo-a"));
    await r.flush();
    expect(r.asked()).toEqual(["frevo-a-1"]);

    await r.advance(1499);
    expect(r.asked()).toEqual(["frevo-a-1"]);
    await r.advance(1);
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-b-1"]);

    await r.answer("frevo-b-1");
    expect(r.results()).toMatchObject([
      { requestId: "boneco-2#1", ok: true, model: "modelo-b" },
    ]);
  });

  test("keeps the boneco's model when one of its participants frees up in time", async () => {
    const r = room([A1, B1], { fallbackMs: 1500 });
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    r.scheduler.submit(request("boneco-2#1", "modelo-a"));
    await r.flush();
    await r.advance(800);
    await r.answer("frevo-a-1");
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-1"]);
  });

  test("lets a later boneco of another model through while one waits for its own", async () => {
    const r = room([A1, B1], { fallbackMs: 1500 });
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    r.scheduler.submit(request("boneco-2#1", "modelo-a"));
    r.scheduler.submit(request("boneco-3#1", "modelo-b"));
    await r.flush();
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-b-1"]);
  });

  test("sends the bonecos of a switched-off model to the others at once", async () => {
    const r = room([A1, B1]);
    r.scheduler.setModelEnabled("modelo-a", false);
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    r.scheduler.submit(request("boneco-2#1"));
    await r.flush();
    expect(r.asked()).toEqual(["frevo-b-1"]);
    await r.answer("frevo-b-1");
    expect(r.asked()).toEqual(["frevo-b-1", "frevo-b-1"]);
    expect(r.scheduler.models()).toEqual([
      { model: "modelo-a", participants: 1, enabled: false },
      { model: "modelo-b", participants: 1, enabled: true },
    ]);

    r.scheduler.setModelEnabled("modelo-a", true);
    r.scheduler.submit(request("boneco-3#1", "modelo-a"));
    await r.flush();
    expect(r.asked().at(-1)).toBe("frevo-a-1");
  });

  test("repeats once when the answer has no valid tool call, then gives up", async () => {
    const r = room([A1]);
    r.scheduler.submit(request("boneco-1#1"));
    await r.flush();
    await r.answer("frevo-a-1", plainText);
    // A cut answer still parses, but fails the schema.
    await r.answer(
      "frevo-a-1",
      toolCall(r.calls[0]?.body as ChatCompletionBody, { acao: "and" })
    );

    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-1"]);
    expect(r.results()).toMatchObject([{ requestId: "boneco-1#1", ok: false }]);
  });

  test("accepts the tool call on the second attempt", async () => {
    const r = room([A1]);
    r.scheduler.submit(request("boneco-1#1"));
    await r.flush();
    await r.answer("frevo-a-1", plainText);
    await r.answer("frevo-a-1");
    expect(r.results()).toMatchObject([
      { ok: true, action: { placeId: "fonte" } },
    ]);
  });

  test("repeats once when the upstream answers with an error", async () => {
    const r = room([A1]);
    r.scheduler.submit(request("boneco-1#1"));
    await r.flush();
    await r.refuse("frevo-a-1", new HubError("upstream 500", 500));
    await r.answer("frevo-a-1");
    expect(r.results()).toMatchObject([{ ok: true }]);
  });

  test("holds a request until a participant shows up, and fails it when none does in time", async () => {
    const r = room([], { requestTimeoutMs: 3000 });
    r.scheduler.submit(request("boneco-1#1"));
    r.scheduler.submit(request("boneco-2#1"));
    await r.advance(1000);
    r.scheduler.setParticipants([A1]);
    await r.flush();
    await r.answer("frevo-a-1");
    expect(r.results()).toMatchObject([{ requestId: "boneco-1#1", ok: true }]);

    r.scheduler.setParticipants([]);
    r.scheduler.submit(request("boneco-3#1"));
    await r.advance(3000);
    expect(r.results().at(-1)).toMatchObject({
      requestId: "boneco-3#1",
      ok: false,
    });
  });

  test("reports a late decision as failed but keeps the participant busy until the hub answers", async () => {
    const r = room([A1, B1], { requestTimeoutMs: 3000 });
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    await r.flush();
    await r.advance(3000);
    expect(r.results()).toMatchObject([{ requestId: "boneco-1#1", ok: false }]);
    expect(r.calls[0]?.signal.aborted).toBe(false);

    r.scheduler.submit(request("boneco-1#2", "modelo-a"));
    await r.advance(2000);
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-b-1"]);

    // The late answer frees the participant and is not repeated.
    await r.answer("frevo-a-1");
    r.scheduler.submit(request("boneco-2#1", "modelo-a"));
    await r.flush();
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-b-1", "frevo-a-1"]);
    expect(r.results().map((result) => result.requestId)).toEqual([
      "boneco-1#1",
    ]);
  });

  test("moves on when the hub says the participant is busy, and leaves it alone until the Room lists it free", async () => {
    const r = room([A1, A2]);
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    await r.flush();
    await r.refuse(
      "frevo-a-1",
      new HubError(
        'chat/completions answered 409: {"error":"Participant is already handling another request."}',
        409
      )
    );
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-2"]);
    await r.answer("frevo-a-2");
    expect(r.results()).toMatchObject([{ ok: true }]);

    r.scheduler.submit(request("boneco-2#1", "modelo-a"));
    await r.flush();
    await r.answer("frevo-a-2");
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-2", "frevo-a-2"]);

    r.scheduler.setParticipants([
      { ...A1, busy: false },
      { ...A2, busy: false },
    ]);
    r.scheduler.submit(request("boneco-3#1", "modelo-a"));
    await r.flush();
    expect(r.asked().at(-1)).toBe("frevo-a-1");
  });

  test("puts everyone on autopilot once the session spends past the ceiling", async () => {
    const r = room([A1], { ceilingUsd: 0.001 });
    r.scheduler.submit(request("boneco-1#1"));
    r.scheduler.submit(request("boneco-2#1"));
    await r.flush();
    await r.answer(
      "frevo-a-1",
      toolCall(r.calls[0]?.body as ChatCompletionBody, WALK, {
        prompt_tokens: 900,
        completion_tokens: 80,
        cost: 0.0015,
      })
    );
    expect(r.scheduler.budget()).toEqual({
      spentUsd: 0.0015,
      ceilingUsd: 0.001,
      exceeded: true,
    });
    r.scheduler.submit(request("boneco-3#1"));
    await r.flush();

    expect(r.asked()).toEqual(["frevo-a-1"]);
    expect(r.results()).toMatchObject([
      { requestId: "boneco-1#1", ok: true },
      { requestId: "boneco-2#1", ok: false },
      { requestId: "boneco-3#1", ok: false },
    ]);

    r.scheduler.resetBudget();
    expect(r.scheduler.budget().exceeded).toBe(false);
    r.scheduler.submit(request("boneco-4#1"));
    await r.flush();
    expect(r.asked()).toEqual(["frevo-a-1", "frevo-a-1"]);
  });

  test("takes turns among free participants when the boneco has no model", async () => {
    const r = room([A1, B1, { id: "frevo-c-1", model: "modelo-c" }]);
    for (let index = 1; index <= 6; index += 1) {
      r.scheduler.submit(request(`boneco-1#${index}`));
      // biome-ignore lint/performance/noAwaitInLoops: each decision finishes before the next is asked.
      await r.flush();
      await r.answer(r.asked().at(-1) as string);
    }
    expect(r.asked()).toEqual([
      "frevo-a-1",
      "frevo-b-1",
      "frevo-c-1",
      "frevo-a-1",
      "frevo-b-1",
      "frevo-c-1",
    ]);
  });

  test("records each call in the models' metrics", async () => {
    const r = room([A1, B1]);
    r.scheduler.submit(request("boneco-1#1", "modelo-a"));
    r.scheduler.submit(request("boneco-2#1", "modelo-b"));
    await r.flush();
    await r.advance(700);
    await r.answer("frevo-a-1");
    await r.answer("frevo-b-1", plainText);

    expect(r.scheduler.metrics.stats()).toMatchObject([
      { model: "modelo-a", decisions: 1, failures: 0, avgMs: 700, inFlight: 0 },
      { model: "modelo-b", decisions: 0, failures: 1, inFlight: 1 },
    ]);
  });
});
