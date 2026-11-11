import { describe, expect, test } from "bun:test";
import { exists, rm } from "node:fs/promises";
import { createDatabasePlan, eventPorts, parseEventArgs } from "./event";

describe("event supervisor", () => {
  test("parses production and deterministic E2E modes", () => {
    expect(parseEventArgs([])).toEqual({ ephemeral: false, fake: false });
    expect(parseEventArgs(["--fake", "--ephemeral"])).toEqual({
      ephemeral: true,
      fake: true,
    });
    expect(() => parseEventArgs(["--unknown"])).toThrow("Unknown option");
  });

  test("keeps the event's known ports unless overridden", () => {
    expect(eventPorts({})).toEqual({ hub: 3000, board: 3001, web: 3002 });
    expect(
      eventPorts({
        GAMBI_HUB_PORT: "4000",
        BOARD_PORT: "0",
        BOARD_WEB_PORT: "",
      })
    ).toEqual({ hub: 4000, board: 0, web: 3002 });
    expect(() => eventPorts({ BOARD_PORT: "70000" })).toThrow("BOARD_PORT");
  });

  test("keeps an explicit database URL", async () => {
    expect(
      await createDatabasePlan({
        configuredUrl: "file:/tmp/event.db",
        ephemeral: true,
        roomCode: "ABC123",
      })
    ).toEqual({
      displayPath: "file:/tmp/event.db",
      url: "file:/tmp/event.db",
    });
  });

  test("creates an isolated database directory for E2E", async () => {
    const plan = await createDatabasePlan({
      ephemeral: true,
      roomCode: "ABC123",
    });
    expect(plan.cleanupDirectory).toBeDefined();
    expect(plan.url).toStartWith("file:/");
    expect(await exists(plan.cleanupDirectory as string)).toBe(true);
    await rm(plan.cleanupDirectory as string, { recursive: true });
  });

  test("puts the E2E database in the given ephemeral directory", async () => {
    const plan = await createDatabasePlan({
      directory: "/tmp/gambi-board-e2e-given",
      ephemeral: true,
      roomCode: "ABC123",
    });
    expect(plan).toEqual({
      cleanupDirectory: "/tmp/gambi-board-e2e-given",
      displayPath: "/tmp/gambi-board-e2e-given/board.db",
      url: "file:/tmp/gambi-board-e2e-given/board.db",
    });
  });
});
