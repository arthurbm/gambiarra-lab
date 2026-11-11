// The models of the Room: how people see them, what they cost, how each one
// is asked (the request fields measured against OpenRouter on 2026-11-11) and
// how its fake stand-in behaves. Shared by the model host (request fields),
// the world (prices, labels) and the web (labels).

export interface Price {
  /** US$ per million input tokens. */
  input: number;
  /** US$ per million output tokens. */
  output: number;
}

/** How a fake model answers, so the panel has something to compare offline. */
export interface FakeProfile {
  /** Share of answers that come back as an upstream error (HTTP 500). */
  errorRate: number;
  /** Share of answers without a usable tool call. */
  invalidRate: number;
  /** Latency drawn uniformly from this range. */
  latencyMs: [number, number];
}

export interface ModelRequestConfig {
  /** Fields set only when the caller did not send them. */
  defaults?: Record<string, unknown>;
  /** Fields set on every request, over what the caller sent. */
  overrides?: Record<string, unknown>;
  /** Fields removed from every request (the model refuses or ignores them). */
  strip?: string[];
}

export interface ModelEntry {
  fake?: FakeProfile;
  id: string;
  label: string;
  /**
   * Price used to estimate the session's spending. For open-weight models the
   * provider that answers sets the price, so these follow what was measured,
   * not the cheapest endpoint in the catalog.
   */
  price: Price;
  request?: ModelRequestConfig;
}

const DECISION_DEFAULTS = { max_tokens: 400 };
const FAST_PROVIDER = { sort: "latency", require_parameters: true };

const REAL_MODELS: ModelEntry[] = [
  {
    id: "anthropic/claude-haiku-5.5",
    label: "Claude Haiku 5.5",
    price: { input: 0.1, output: 0.5 },
    request: {
      defaults: DECISION_DEFAULTS,
      overrides: { reasoning: { effort: "none" } },
      strip: ["temperature", "top_p", "top_k"],
    },
  },
  {
    // Replaces minimax/minimax-m3.1-flash, which leaked Chinese characters
    // into about 12% of its lines (issue #18).
    id: "minimax/minimax-m3",
    label: "MiniMax M3",
    price: { input: 0.3, output: 1.2 },
    request: {
      defaults: DECISION_DEFAULTS,
      // Under load OpenRouter routed it to Venice, which reasons until
      // max_tokens and answers without a tool call (16 of 21 in a burst, and
      // most of the failures on the 25-phone rehearsals), and once leaked
      // Chinese with reasoning off. CoreWeave with reasoning off: 21 of 21.
      overrides: {
        reasoning: { effort: "none" },
        provider: {
          order: ["coreweave", "minimax"],
          allow_fallbacks: true,
          require_parameters: true,
        },
      },
    },
  },
  {
    id: "openai/gpt-6-luna",
    label: "GPT-6 Luna",
    price: { input: 0.1, output: 0.5 },
    request: {
      defaults: DECISION_DEFAULTS,
      overrides: { reasoning: { effort: "none" } },
      strip: ["temperature", "top_p", "top_k"],
    },
  },
  {
    id: "deepseek/deepseek-v4.1-flash-1017",
    label: "DeepSeek V4.1 Flash",
    price: { input: 0.1, output: 0.6 },
    request: {
      defaults: DECISION_DEFAULTS,
      overrides: { reasoning: { effort: "none" }, provider: FAST_PROVIDER },
    },
  },
  {
    id: "z-ai/glm-5.3-flash",
    label: "GLM 5.3 Flash",
    price: { input: 0.07, output: 0.25 },
    request: {
      defaults: DECISION_DEFAULTS,
      // Reasoning is mandatory on GLM; "low" is its minimum.
      overrides: {
        reasoning: { effort: "low", exclude: true },
        provider: FAST_PROVIDER,
      },
    },
  },
  {
    // Spare from another vendor, in case one of the five goes down on the day.
    id: "google/gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash Lite",
    price: { input: 0.3, output: 2.5 },
    request: {
      defaults: DECISION_DEFAULTS,
      overrides: { reasoning: { effort: "minimal" } },
    },
  },
];

/** Offline stand-ins with the same shape as the stage, for rehearsals. */
const FAKE_MODELS: ModelEntry[] = [
  {
    id: "fake-haiku",
    label: "Haiku (falso)",
    price: { input: 0.1, output: 0.5 },
    fake: { latencyMs: [900, 1600], invalidRate: 0.02, errorRate: 0.01 },
  },
  {
    id: "fake-minimax",
    label: "MiniMax (falso)",
    price: { input: 0.3, output: 1.2 },
    fake: { latencyMs: [400, 1100], invalidRate: 0.03, errorRate: 0.01 },
  },
  {
    id: "fake-luna",
    label: "Luna (falso)",
    price: { input: 0.1, output: 0.5 },
    fake: { latencyMs: [900, 2800], invalidRate: 0.02, errorRate: 0.02 },
  },
  {
    id: "fake-deepseek",
    label: "DeepSeek (falso)",
    price: { input: 0.1, output: 0.6 },
    fake: { latencyMs: [700, 2000], invalidRate: 0.05, errorRate: 0.02 },
  },
  {
    id: "fake-glm",
    label: "GLM (falso)",
    price: { input: 0.07, output: 0.25 },
    fake: { latencyMs: [800, 2100], invalidRate: 0.08, errorRate: 0.04 },
  },
];

/** A price for models outside the catalog, high enough to stay on the safe side. */
const UNKNOWN_PRICE: Price = { input: 0.5, output: 2 };

const BY_ID = new Map(
  [...REAL_MODELS, ...FAKE_MODELS].map((entry) => [entry.id, entry])
);

export function modelEntry(id: string): ModelEntry {
  return BY_ID.get(id) ?? { id, label: id, price: UNKNOWN_PRICE };
}

export function modelLabel(id: string): string {
  return modelEntry(id).label;
}

/**
 * The twelve participants on stage: three for the models that answer slowest
 * under load (Luna, GLM), two for the others.
 */
export const DEFAULT_REAL_MODELS =
  "anthropic/claude-haiku-5.5:2,minimax/minimax-m3:2,openai/gpt-6-luna:3,deepseek/deepseek-v4.1-flash-1017:2,z-ai/glm-5.3-flash:3";
export const DEFAULT_FAKE_MODELS =
  "fake-haiku:2,fake-minimax:2,fake-luna:3,fake-deepseek:2,fake-glm:3";

export interface ModelSpec {
  /** The model id the upstream serves. */
  model: string;
  /** How many participants to keep open; each answers one request at a time. */
  participants: number;
}

/** `model[:participants]` separated by commas. */
export function parseModels(raw: string): ModelSpec[] {
  const models = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.lastIndexOf(":");
      const model = separator < 0 ? entry : entry.slice(0, separator);
      const participants =
        separator < 0 ? 1 : Number(entry.slice(separator + 1));
      if (!(model && Number.isInteger(participants) && participants > 0)) {
        throw new Error(
          `FREVO_MODELS: cannot read "${entry}"; use model[:participants], separated by commas`
        );
      }
      return { model, participants };
    });
  if (models.length === 0) {
    throw new Error("FREVO_MODELS lists no model");
  }
  return models;
}

/** The models of this run, as the model host and the world both read them. */
export function modelSpecs(
  env: Record<string, string | undefined>
): ModelSpec[] {
  const fake = env.FREVO_MODEL_HOST_MODE?.trim() === "fake";
  return parseModels(
    env.FREVO_MODELS?.trim() ||
      (fake ? DEFAULT_FAKE_MODELS : DEFAULT_REAL_MODELS)
  );
}

/** The request as the model wants it: per-model fields merged over the caller's body. */
export function requestFor(
  model: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const config = modelEntry(model).request;
  if (!config) {
    return body;
  }
  const merged: Record<string, unknown> = { ...config.defaults, ...body };
  for (const field of config.strip ?? []) {
    delete merged[field];
  }
  Object.assign(merged, config.overrides);
  // With one tool, "required" forces it on every provider; the named form is
  // refused by Z.AI's first-party endpoint.
  if (Array.isArray(merged.tools) && merged.tools.length === 1) {
    merged.tool_choice = "required";
  }
  return merged;
}
