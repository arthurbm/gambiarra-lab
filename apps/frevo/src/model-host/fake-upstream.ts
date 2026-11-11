// A fake provider: an OpenAI-compatible endpoint on a free local port that
// answers every chat/completions with a valid call to the forced tool. It is
// deterministic and never touches the network, so tests, the smoke and a
// local rehearsal can run the whole path without a key. Each model can have a
// profile (latency, errors, unusable answers) so a rehearsal shows the models
// panel comparing something.
import type { FakeProfile } from "../models/catalog";

const LINES = [
  "Eita, bora ver o que tem por lá!",
  "Ouvi um trombone, vou atrás.",
  "Aqui tá bom, mas ali tá melhor.",
  "Quem sabe acho meu bloco por lá.",
  "Vou no passo, sem pressa.",
  "Tá cheirando a tapioca, simbora!",
  "Frevo não espera, eu também não.",
  "Vou dar um rolê e já volto.",
];

export interface FakeUpstream {
  /** Base URL, without `/v1`, as createParticipantSession expects. */
  endpoint: string;
  stop: () => void;
}

export interface FakeUpstreamOptions {
  /** Delay before each answer, for every model; overrides the profiles' latency. */
  latencyMs?: number;
  models: string[];
  onRequest?: (body: Record<string, unknown>) => void;
  /** How each model behaves; a model without one answers well and at once. */
  profiles?: Record<string, FakeProfile | undefined>;
  /** Seed of the draws for latency and failures. */
  seed?: number;
  /** Answer with plain text instead of a tool call. */
  silent?: boolean;
}

interface JsonSchema {
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string;
}

function hash(text: string): number {
  let value = 7;
  for (let index = 0; index < text.length; index += 1) {
    value = (value * 31 + text.charCodeAt(index)) % 1_000_000_007;
  }
  return value;
}

/** A value that satisfies `schema`, chosen by `seed`. */
function valueFor(schema: JsonSchema, seed: number): unknown {
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[seed % schema.enum.length];
  }
  switch (schema.type) {
    case "object": {
      const value: Record<string, unknown> = {};
      const properties = schema.properties ?? {};
      for (const [index, key] of Object.keys(properties).entries()) {
        value[key] = valueFor(properties[key] as JsonSchema, seed + index);
      }
      return value;
    }
    case "array":
      return schema.items ? [valueFor(schema.items, seed)] : [];
    case "number":
    case "integer":
      return seed % 10;
    case "boolean":
      return seed % 2 === 0;
    default:
      return LINES[seed % LINES.length];
  }
}

interface ToolLike {
  function?: { name?: string; parameters?: JsonSchema };
}

function forcedTool(body: Record<string, unknown>): ToolLike | undefined {
  const tools = Array.isArray(body.tools) ? (body.tools as ToolLike[]) : [];
  const forced = (body.tool_choice as { function?: { name?: string } } | null)
    ?.function?.name;
  return tools.find((tool) => tool.function?.name === forced) ?? tools[0];
}

function completion(
  model: string,
  body: Record<string, unknown>,
  sequence: number,
  answer: "invalid" | "silent" | "valid"
) {
  const tool = answer === "silent" ? undefined : forcedTool(body);
  const seed = hash(JSON.stringify(body.messages ?? "")) + sequence;
  const message = tool?.function?.name
    ? {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `call_fake_${sequence}`,
            type: "function",
            function: {
              name: tool.function.name,
              // An unusable answer is cut short, the way a model that ran
              // out of tokens answers: it parses, but misses fields.
              arguments:
                answer === "invalid"
                  ? "{}"
                  : JSON.stringify(
                      valueFor(
                        tool.function.parameters ?? { type: "object" },
                        seed
                      )
                    ),
            },
          },
        ],
      }
    : { role: "assistant", content: LINES[seed % LINES.length] };
  return {
    id: `chatcmpl_fake_${sequence}`,
    object: "chat.completion",
    created: 0,
    model,
    choices: [
      {
        index: 0,
        finish_reason: tool ? "tool_calls" : "stop",
        message,
      },
    ],
    usage: { prompt_tokens: 900, completion_tokens: 80, total_tokens: 980 },
  };
}

export function startFakeUpstream(options: FakeUpstreamOptions): FakeUpstream {
  let sequence = 0;
  // Park-Miller, so a rehearsal with the same seed fails the same way.
  let state = Math.max(
    1,
    Math.trunc(options.seed ?? 20_261_111) % 2_147_483_646
  );
  const draw = () => {
    state = (state * 48_271) % 2_147_483_647;
    return (state - 1) / 2_147_483_646;
  };
  async function answerChat(body: Record<string, unknown>) {
    // The SDK probes the endpoint with an empty body before joining.
    if (!Array.isArray(body.messages)) {
      return Response.json(
        { error: { message: "messages is required" } },
        { status: 400 }
      );
    }
    options.onRequest?.(body);
    sequence += 1;
    const model = String(body.model);
    const profile = options.profiles?.[model];
    const [low, high] = profile?.latencyMs ?? [0, 0];
    const latencyMs = options.latencyMs ?? low + draw() * (high - low);
    if (latencyMs > 0) {
      await Bun.sleep(latencyMs);
    }
    if (profile && draw() < profile.errorRate) {
      return Response.json(
        { error: { message: "the fake provider failed on purpose" } },
        { status: 500 }
      );
    }
    let answer: "invalid" | "silent" | "valid" = "valid";
    if (options.silent) {
      answer = "silent";
    } else if (profile && draw() < profile.invalidRate) {
      answer = "invalid";
    }
    return Response.json(completion(model, body, sequence, answer));
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url);
      if (request.method === "GET" && pathname === "/v1/models") {
        return Response.json({
          object: "list",
          data: options.models.map((id) => ({
            id,
            object: "model",
            owned_by: "frevo-fake",
          })),
        });
      }
      if (request.method === "POST" && pathname === "/v1/chat/completions") {
        return answerChat(
          (await request.json().catch(() => ({}))) as Record<string, unknown>
        );
      }
      return new Response("Not Found", { status: 404 });
    },
  });
  return {
    endpoint: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(true),
  };
}
