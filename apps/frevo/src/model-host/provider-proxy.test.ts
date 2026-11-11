import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { requestFor } from "../models/catalog";
import { startFakeUpstream } from "./fake-upstream";
import { type ProviderProxy, startProviderProxy } from "./provider-proxy";

/** A provider that records what reached it and who sent it. */
function recordingProvider() {
  const received: { authorization: string | null; body: unknown }[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      received.push({
        authorization: request.headers.get("authorization"),
        body: await request.json(),
      });
      return Response.json(
        { id: "x", usage: { cost: 0.0001 } },
        { status: 201 }
      );
    },
  });
  return {
    received,
    endpoint: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}

let provider: ReturnType<typeof recordingProvider>;
let proxy: ProviderProxy;

beforeAll(() => {
  provider = recordingProvider();
  proxy = startProviderProxy({
    models: ["z-ai/glm-5.3-flash", "openai/gpt-6-luna"],
    upstream: {
      endpoint: provider.endpoint,
      authHeaders: { Authorization: "Bearer sk-secret" },
    },
  });
});

afterAll(() => {
  proxy.stop();
  provider.stop();
});

const TOOL = {
  type: "function",
  function: { name: "agir", description: "", parameters: { type: "object" } },
};

describe("the provider proxy", () => {
  test("lists its models and refuses an empty body without calling the provider", async () => {
    const models = (await (
      await fetch(`${proxy.endpoint}/v1/models`)
    ).json()) as { data: { id: string }[] };
    expect(models.data.map((model) => model.id)).toEqual([
      "z-ai/glm-5.3-flash",
      "openai/gpt-6-luna",
    ]);
    const probe = await fetch(`${proxy.endpoint}/v1/chat/completions`, {
      method: "POST",
      body: "{}",
    });
    expect(probe.status).toBe(400);
    expect(provider.received).toHaveLength(0);
  });

  test("sends each model's request fields and the key to the provider, and its answer back", async () => {
    const answer = await fetch(`${proxy.endpoint}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "z-ai/glm-5.3-flash",
        stream: false,
        messages: [{ role: "user", content: "Oi" }],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "agir" } },
      }),
    });
    expect(answer.status).toBe(201);
    expect(await answer.json()).toEqual({ id: "x", usage: { cost: 0.0001 } });
    expect(provider.received.at(-1)).toEqual({
      authorization: "Bearer sk-secret",
      body: {
        model: "z-ai/glm-5.3-flash",
        stream: false,
        messages: [{ role: "user", content: "Oi" }],
        tools: [TOOL],
        tool_choice: "required",
        max_tokens: 400,
        reasoning: { effort: "low", exclude: true },
        provider: { sort: "latency", require_parameters: true },
      },
    });
  });
});

describe("a model's request fields", () => {
  test("keep the caller's max_tokens, drop a refused temperature and turn reasoning down", () => {
    expect(
      requestFor("openai/gpt-6-luna", {
        model: "openai/gpt-6-luna",
        max_tokens: 700,
        temperature: 0.7,
        messages: [],
      })
    ).toEqual({
      model: "openai/gpt-6-luna",
      max_tokens: 700,
      messages: [],
      reasoning: { effort: "none" },
    });
  });

  test("keep MiniMax M3 off reasoning and on the provider measured without leaks", () => {
    const sent = requestFor("minimax/minimax-m3", {
      model: "minimax/minimax-m3",
      messages: [],
    });
    expect(sent.reasoning).toEqual({ effort: "none" });
    expect(sent.provider).toMatchObject({ order: ["coreweave", "minimax"] });
  });

  test("leave a model outside the catalog alone", () => {
    const body = { model: "outro/modelo", temperature: 0.2, messages: [] };
    expect(requestFor("outro/modelo", body)).toEqual(body);
  });
});

describe("the fake provider", () => {
  test("answers each model with its own latency, and fails as often as told", async () => {
    const fake = startFakeUpstream({
      models: ["lento", "quebrado"],
      profiles: {
        lento: { latencyMs: [120, 120], invalidRate: 0, errorRate: 0 },
        quebrado: { latencyMs: [0, 0], invalidRate: 0, errorRate: 1 },
      },
    });
    const ask = (model: string) =>
      fetch(`${fake.endpoint}/v1/chat/completions`, {
        method: "POST",
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Oi" }],
          tools: [TOOL],
          tool_choice: "required",
        }),
      });
    try {
      const startedAt = performance.now();
      const slow = await ask("lento");
      expect(slow.status).toBe(200);
      expect(performance.now() - startedAt).toBeGreaterThanOrEqual(110);
      const broken = await ask("quebrado");
      expect(broken.status).toBe(500);
    } finally {
      fake.stop();
    }
  });

  test("answers without a usable tool call as often as told", async () => {
    const fake = startFakeUpstream({
      models: ["confuso"],
      profiles: {
        confuso: { latencyMs: [0, 0], invalidRate: 1, errorRate: 0 },
      },
    });
    try {
      const answer = (await (
        await fetch(`${fake.endpoint}/v1/chat/completions`, {
          method: "POST",
          body: JSON.stringify({
            model: "confuso",
            messages: [{ role: "user", content: "Oi" }],
            tools: [TOOL],
          }),
        })
      ).json()) as {
        choices: {
          message: { tool_calls: { function: { arguments: string } }[] };
        }[];
      };
      // Cut short, the way a model that ran out of tokens answers.
      expect(answer.choices[0]?.message.tool_calls[0]?.function.arguments).toBe(
        "{}"
      );
    } finally {
      fake.stop();
    }
  });
});
