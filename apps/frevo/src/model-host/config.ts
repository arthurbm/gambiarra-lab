// Reads the model host's configuration from the environment. The provider key
// comes from OPENROUTER_API_KEY or from a file, and goes nowhere but the
// upstream's Authorization header.
import { homedir } from "node:os";
import { join } from "node:path";
import type { ModelSpec, Upstream } from "./host";

type Env = Record<string, string | undefined>;

interface BaseConfig {
  hubUrl: string;
  models: ModelSpec[];
  roomName: string;
}

export type ModelHostConfig =
  | (BaseConfig & { mode: "fake" })
  | (BaseConfig & { mode: "openrouter"; upstream: Upstream });

export const DEFAULT_HUB_URL = "http://127.0.0.1:3210";
export const DEFAULT_ROOM_NAME = "bloco-de-frevo";
const DEFAULT_REAL_MODELS = "anthropic/claude-haiku-5.5:2";
const DEFAULT_FAKE_MODELS = "fake-frevo-a:1,fake-frevo-b:1";
const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const TRAILING_SLASH = /\/+$/;
const TRAILING_V1 = /\/v1$/;

/** `model[:participants]` separated by commas. */
function parseModels(raw: string): ModelSpec[] {
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

async function providerKey(env: Env): Promise<string> {
  const fromEnv = env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) {
    return fromEnv;
  }
  const path =
    env.OPENROUTER_API_KEY_FILE?.trim() ||
    join(homedir(), ".config", "gambiarra-lab", "openrouter.key");
  const fromFile = await Bun.file(path)
    .text()
    .then((text) => text.trim())
    .catch(() => "");
  if (!fromFile) {
    throw new Error(
      `Set OPENROUTER_API_KEY, or put the key in ${path} (OPENROUTER_API_KEY_FILE), or use FREVO_MODEL_HOST_MODE=fake`
    );
  }
  return fromFile;
}

export async function modelHostConfig(
  env: Env = process.env
): Promise<ModelHostConfig> {
  const mode = env.FREVO_MODEL_HOST_MODE?.trim() || "openrouter";
  if (mode !== "fake" && mode !== "openrouter") {
    throw new Error('FREVO_MODEL_HOST_MODE must be "fake" or "openrouter"');
  }
  const base = {
    hubUrl: (env.GAMBI_HUB_URL?.trim() || DEFAULT_HUB_URL).replace(
      TRAILING_SLASH,
      ""
    ),
    roomName: env.FREVO_ROOM_NAME?.trim() || DEFAULT_ROOM_NAME,
  };
  if (mode === "fake") {
    return {
      ...base,
      mode,
      models: parseModels(env.FREVO_MODELS?.trim() || DEFAULT_FAKE_MODELS),
    };
  }
  const models = parseModels(env.FREVO_MODELS?.trim() || DEFAULT_REAL_MODELS);
  // The SDK appends `/v1/...` to the endpoint it is given.
  const endpoint = (env.OPENROUTER_BASE_URL?.trim() || DEFAULT_BASE_URL)
    .replace(TRAILING_SLASH, "")
    .replace(TRAILING_V1, "");
  return {
    ...base,
    mode,
    models,
    upstream: {
      endpoint,
      authHeaders: { Authorization: `Bearer ${await providerKey(env)}` },
    },
  };
}
