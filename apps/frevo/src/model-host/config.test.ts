import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modelHostConfig } from "./config";

describe("the model host's configuration", () => {
  test("defaults to the real provider with twelve participants on five models, reading the key from the environment", async () => {
    const config = await modelHostConfig({ OPENROUTER_API_KEY: "sk-test" });
    expect(config).toEqual({
      mode: "openrouter",
      hubUrl: "http://127.0.0.1:3210",
      roomName: "bloco-de-frevo",
      models: [
        { model: "anthropic/claude-haiku-5.5", participants: 2 },
        { model: "minimax/minimax-m3", participants: 2 },
        { model: "openai/gpt-6-luna", participants: 3 },
        { model: "deepseek/deepseek-v4.1-flash-1017", participants: 2 },
        { model: "z-ai/glm-5.3-flash", participants: 3 },
      ],
      upstream: {
        endpoint: "https://openrouter.ai/api",
        authHeaders: { Authorization: "Bearer sk-test" },
      },
    });
  });

  test("reads the key from a file, trimming the line break", async () => {
    const directory = await mkdtemp(join(tmpdir(), "frevo-key-"));
    const keyFile = join(directory, "openrouter.key");
    await writeFile(keyFile, "sk-from-file\n");
    try {
      const config = await modelHostConfig({
        OPENROUTER_API_KEY_FILE: keyFile,
        FREVO_MODELS: "openai/gpt-6-luna:3, z-ai/glm-5.3-flash",
        GAMBI_HUB_URL: "http://hub.internal:3000/",
        FREVO_ROOM_NAME: "ensaio",
        OPENROUTER_BASE_URL: "https://example.test/api/v1/",
      });
      expect(config.mode).toBe("openrouter");
      if (config.mode !== "openrouter") {
        return;
      }
      expect(config.upstream).toEqual({
        endpoint: "https://example.test/api",
        authHeaders: { Authorization: "Bearer sk-from-file" },
      });
      expect(config.models).toEqual([
        { model: "openai/gpt-6-luna", participants: 3 },
        { model: "z-ai/glm-5.3-flash", participants: 1 },
      ]);
      expect(config.hubUrl).toBe("http://hub.internal:3000");
      expect(config.roomName).toBe("ensaio");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("refuses to start the real provider without a key", async () => {
    await expect(
      modelHostConfig({
        OPENROUTER_API_KEY_FILE: "/nonexistent/openrouter.key",
      })
    ).rejects.toThrow("OPENROUTER_API_KEY");
  });

  test("needs no key in fake mode and names its own models", async () => {
    const config = await modelHostConfig({ FREVO_MODEL_HOST_MODE: "fake" });
    expect(config.mode).toBe("fake");
    expect(config.models).toEqual([
      { model: "fake-haiku", participants: 2 },
      { model: "fake-minimax", participants: 2 },
      { model: "fake-luna", participants: 3 },
      { model: "fake-deepseek", participants: 2 },
      { model: "fake-glm", participants: 3 },
    ]);
    expect("upstream" in config).toBe(false);
  });

  test("rejects a model list it cannot read", async () => {
    await expect(
      modelHostConfig({ FREVO_MODEL_HOST_MODE: "fake", FREVO_MODELS: "a:zero" })
    ).rejects.toThrow("FREVO_MODELS");
    await expect(
      modelHostConfig({ FREVO_MODEL_HOST_MODE: "banana" })
    ).rejects.toThrow("FREVO_MODEL_HOST_MODE");
  });
});
