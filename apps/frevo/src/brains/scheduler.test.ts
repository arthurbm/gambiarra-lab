import { describe, expect, test } from "bun:test";
import type { BrainResult, DecisionRequest } from "../sim/world";
import { PRACA } from "../sim/world";
import {
  type ChatCompletionBody,
  createBrainScheduler,
  type Inference,
} from "./scheduler";

function request(id: string): DecisionRequest {
  return {
    id,
    boneco: { id: "boneco-1", name: "Capiba" },
    deadlineMs: 12_000,
    placeId: null,
    places: PRACA.places,
  };
}

/** A chat completion that calls the forced tool with `args`. */
function toolCall(body: ChatCompletionBody, args: unknown) {
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
                name: body.tool_choice.function.name,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

const plainText = {
  choices: [
    {
      finish_reason: "stop",
      message: { role: "assistant", content: "Acho que vou até a fonte." },
    },
  ],
};

async function drained(
  scheduler: { drain: () => BrainResult[] },
  count: number
) {
  const results: BrainResult[] = [];
  for (let attempt = 0; attempt < 200 && results.length < count; attempt += 1) {
    results.push(...scheduler.drain());
    if (results.length < count) {
      // biome-ignore lint/performance/noAwaitInLoops: polls the scheduler until the calls settle.
      await Bun.sleep(5);
    }
  }
  return results;
}

describe("the brain scheduler", () => {
  test("asks a free participant, forcing one tool, and returns the action", async () => {
    const calls: { body: ChatCompletionBody; participantId: string }[] = [];
    const infer: Inference = (participantId, body) => {
      calls.push({ participantId, body });
      return Promise.resolve(
        toolCall(body, { lugar: "fonte", fala: "Vou ver a fonte!" })
      );
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);

    scheduler.submit(request("boneco-1#1"));
    const results = await drained(scheduler, 1);

    expect(results).toEqual([
      {
        requestId: "boneco-1#1",
        ok: true,
        action: { type: "walk", placeId: "fonte", speech: "Vou ver a fonte!" },
        model: "modelo-a",
      },
    ]);
    expect(calls).toHaveLength(1);
    const [call] = calls as [(typeof calls)[number]];
    expect(call.participantId).toBe("frevo-a-1");
    expect(call.body.model).toBe("frevo-a-1");
    expect(call.body.stream).toBe(false);
    expect(call.body.tools).toHaveLength(1);
    expect(call.body.tool_choice).toEqual({
      type: "function",
      function: { name: call.body.tools[0]?.function.name as string },
    });
  });

  test("sends one request at a time to each participant", async () => {
    const inFlight = new Map<string, number>();
    let peak = 0;
    const infer: Inference = async (participantId, body) => {
      const now = (inFlight.get(participantId) ?? 0) + 1;
      inFlight.set(participantId, now);
      peak = Math.max(peak, now);
      await Bun.sleep(15);
      inFlight.set(participantId, now - 1);
      return toolCall(body, { lugar: "palco", fala: "Simbora" });
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([
      { id: "frevo-a-1", model: "modelo-a" },
      { id: "frevo-a-2", model: "modelo-a" },
    ]);

    for (let index = 1; index <= 6; index += 1) {
      scheduler.submit(request(`boneco-${index}#1`));
    }
    const results = await drained(scheduler, 6);

    expect(results.filter((result) => result.ok)).toHaveLength(6);
    expect(peak).toBe(1);
    expect([...inFlight.keys()].sort()).toEqual(["frevo-a-1", "frevo-a-2"]);
  });

  test("repeats once when the model answers without the tool, then gives up", async () => {
    let attempts = 0;
    const infer: Inference = () => {
      attempts += 1;
      return Promise.resolve(plainText);
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);

    scheduler.submit(request("boneco-1#1"));
    const [result] = await drained(scheduler, 1);

    expect(attempts).toBe(2);
    expect(result?.ok).toBe(false);
    expect(result?.requestId).toBe("boneco-1#1");
  });

  test("accepts the tool call on the second attempt", async () => {
    let attempts = 0;
    const infer: Inference = (_participantId, body) => {
      attempts += 1;
      return Promise.resolve(
        attempts === 1
          ? plainText
          : toolCall(body, { lugar: "coreto", fala: "Agora vai" })
      );
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);

    scheduler.submit(request("boneco-1#1"));
    const [result] = await drained(scheduler, 1);

    expect(result).toMatchObject({
      ok: true,
      action: { type: "walk", placeId: "coreto", speech: "Agora vai" },
    });
  });

  test("holds a request until a participant shows up", async () => {
    const infer: Inference = (_participantId, body) =>
      Promise.resolve(toolCall(body, { lugar: "ponte", fala: "Opa" }));
    const scheduler = createBrainScheduler({ infer });

    scheduler.submit(request("boneco-1#1"));
    await Bun.sleep(20);
    expect(scheduler.drain()).toEqual([]);

    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);
    const [result] = await drained(scheduler, 1);
    expect(result?.ok).toBe(true);
  });

  test("reports a failure when nobody answers in time, and frees the participant", async () => {
    let calls = 0;
    const infer: Inference = (_participantId, body, signal) => {
      calls += 1;
      if (calls > 1) {
        return Promise.resolve(toolCall(body, { lugar: "ponte", fala: "Opa" }));
      }
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      });
    };
    const scheduler = createBrainScheduler({ infer, requestTimeoutMs: 30 });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);

    scheduler.submit(request("boneco-1#1"));
    const [timedOut] = await drained(scheduler, 1);
    expect(timedOut).toMatchObject({ requestId: "boneco-1#1", ok: false });

    scheduler.submit(request("boneco-1#2"));
    const [next] = await drained(scheduler, 1);
    expect(next).toMatchObject({ requestId: "boneco-1#2", ok: true });
  });

  test("reports a failure when a queued request waits too long for a participant", async () => {
    const infer: Inference = (_participantId, body) =>
      Promise.resolve(toolCall(body, { lugar: "ponte", fala: "Opa" }));
    const scheduler = createBrainScheduler({ infer, requestTimeoutMs: 30 });

    scheduler.submit(request("boneco-1#1"));
    const [result] = await drained(scheduler, 1);
    expect(result).toMatchObject({ requestId: "boneco-1#1", ok: false });
  });
});

describe("the brain scheduler choosing among free participants", () => {
  test("takes turns instead of always asking the first one", async () => {
    const asked: string[] = [];
    const infer: Inference = (participantId, body) => {
      asked.push(participantId);
      return Promise.resolve(toolCall(body, { lugar: "ponte", fala: "Opa" }));
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([
      { id: "frevo-a-1", model: "modelo-a" },
      { id: "frevo-b-1", model: "modelo-b" },
      { id: "frevo-c-1", model: "modelo-c" },
    ]);

    for (let index = 1; index <= 6; index += 1) {
      scheduler.submit(request(`boneco-1#${index}`));
      // biome-ignore lint/performance/noAwaitInLoops: each decision finishes before the next is asked, so every participant is free.
      await drained(scheduler, 1);
    }

    expect(asked).toEqual([
      "frevo-a-1",
      "frevo-b-1",
      "frevo-c-1",
      "frevo-a-1",
      "frevo-b-1",
      "frevo-c-1",
    ]);
  });
});

describe("the brain scheduler and the boneco's own model", () => {
  test("asks a free participant of the boneco's model first", async () => {
    const asked: string[] = [];
    const infer: Inference = (participantId, body) => {
      asked.push(participantId);
      return Promise.resolve(toolCall(body, { lugar: "ponte", fala: "Opa" }));
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([
      { id: "frevo-a-1", model: "modelo-a" },
      { id: "frevo-b-1", model: "modelo-b" },
    ]);
    for (let index = 1; index <= 3; index += 1) {
      scheduler.submit({ ...request(`boneco-1#${index}`), model: "modelo-b" });
      // biome-ignore lint/performance/noAwaitInLoops: one decision at a time, so both participants are free.
      await drained(scheduler, 1);
    }
    expect(asked).toEqual(["frevo-b-1", "frevo-b-1", "frevo-b-1"]);
  });

  test("falls back to any free participant when the boneco's model is busy", async () => {
    const asked: string[] = [];
    const infer: Inference = async (participantId, body) => {
      asked.push(participantId);
      await Bun.sleep(15);
      return toolCall(body, { lugar: "ponte", fala: "Opa" });
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([
      { id: "frevo-a-1", model: "modelo-a" },
      { id: "frevo-b-1", model: "modelo-b" },
    ]);
    scheduler.submit({ ...request("boneco-1#1"), model: "modelo-b" });
    scheduler.submit({ ...request("boneco-2#1"), model: "modelo-b" });
    const results = await drained(scheduler, 2);
    expect(results.map((result) => result.ok)).toEqual([true, true]);
    expect(asked.sort()).toEqual(["frevo-a-1", "frevo-b-1"]);
  });
});

describe("the brain scheduler during the interview", () => {
  const base = {
    boneco: { id: "boneco-1", name: "Biu" },
    deadlineMs: 8000,
    model: "modelo-a",
  };

  test("asks the model for a tap question with two or three choices", async () => {
    let sent: ChatCompletionBody | undefined;
    const infer: Inference = (_participantId, body) => {
      sent = body;
      return Promise.resolve(
        toolCall(body, {
          pergunta: "Cuscuz ou tapioca?",
          opcoes: ["Cuscuz", "Tapioca"],
        })
      );
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);
    scheduler.submit({
      ...base,
      id: "boneco-1#1",
      kind: "question",
      index: 0,
      total: 3,
      previous: [],
    });
    const [result] = await drained(scheduler, 1);
    expect(result).toMatchObject({
      ok: true,
      action: {
        type: "question",
        question: "Cuscuz ou tapioca?",
        options: ["Cuscuz", "Tapioca"],
      },
    });
    expect(JSON.stringify(sent?.messages)).toContain("Recife");
  });

  test("asks for the personality with the free text, and the instrument", async () => {
    let sent: ChatCompletionBody | undefined;
    const infer: Inference = (_participantId, body) => {
      sent = body;
      return Promise.resolve(
        toolCall(body, {
          resumo: "Linha um.\nLinha dois.",
          instrumento: "tuba",
          fala: "Achei meu som!",
        })
      );
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);
    scheduler.submit({
      ...base,
      id: "boneco-1#4",
      kind: "personality",
      answers: [{ question: "Cuscuz ou tapioca?", answer: "Cuscuz" }],
      freeText: "toco zabumba",
      instruments: ["tuba", "surdo"],
    });
    const [result] = await drained(scheduler, 1);
    expect(result).toMatchObject({
      ok: true,
      action: {
        type: "personality",
        summary: "Linha um.\nLinha dois.",
        instrument: "tuba",
        speech: "Achei meu som!",
      },
    });
    expect(JSON.stringify(sent?.messages)).toContain("toco zabumba");
  });

  test("repeats when the model answers a question without choices", async () => {
    let attempts = 0;
    const infer: Inference = (_participantId, body) => {
      attempts += 1;
      return Promise.resolve(toolCall(body, { pergunta: "Frevo?" }));
    };
    const scheduler = createBrainScheduler({ infer });
    scheduler.setParticipants([{ id: "frevo-a-1", model: "modelo-a" }]);
    scheduler.submit({
      ...base,
      id: "boneco-1#1",
      kind: "question",
      index: 0,
      total: 3,
      previous: [],
    });
    const [result] = await drained(scheduler, 1);
    expect(attempts).toBe(2);
    expect(result?.ok).toBe(false);
  });
});
