import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  commandOf,
  isAlive,
  readRecord,
  stopRecorded,
  writeRecord,
} from "./frevo-pidfile";

const dir = mkdtempSync(join(tmpdir(), "frevo-stop-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A stand-in for frevo:dev: a parent and one child in its own group. */
async function fakeDev(name: string, ignoreTerm: boolean) {
  const child = Bun.spawn(["bun", "-e", "await Bun.sleep(60_000)"], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  const parent = Bun.spawn(
    [
      "bun",
      "-e",
      ignoreTerm
        ? `process.on("SIGTERM", () => {}); await Bun.sleep(60_000); // ${name}`
        : `process.on("SIGTERM", () => { process.kill(-${child.pid}, "SIGTERM"); process.exit(0); }); await Bun.sleep(60_000); // ${name}`,
    ],
    { stdio: ["ignore", "ignore", "ignore"] }
  );
  await Bun.sleep(300);
  const path = join(dir, `${name}.json`);
  await writeRecord(
    {
      pid: parent.pid,
      command: commandOf(parent.pid),
      cwd: dir,
      groups: [child.pid],
      startedAt: new Date().toISOString(),
    },
    path
  );
  return { child, parent, path };
}

describe("frevo:stop", () => {
  test("stops the recorded run and leaves another one alone", async () => {
    const mine = await fakeDev("mine", false);
    const other = await fakeDev("other", false);
    const result = await stopRecorded({ path: mine.path });
    expect(result.stopped).toBe(true);
    await Promise.all([mine.parent.exited, mine.child.exited]);
    expect(isAlive(mine.parent.pid)).toBe(false);
    expect(await readRecord(mine.path)).toBeNull();
    expect(isAlive(other.parent.pid)).toBe(true);
    expect(isAlive(other.child.pid)).toBe(true);
    await stopRecorded({ path: other.path });
    await Promise.all([other.parent.exited, other.child.exited]);
  }, 20_000);

  test("forces a parent that ignores SIGTERM, and its groups", async () => {
    const stuck = await fakeDev("stuck", true);
    const result = await stopRecorded({ path: stuck.path, timeoutMs: 500 });
    expect(result.message).toContain("forcing");
    await Promise.all([stuck.parent.exited, stuck.child.exited]);
    expect(isAlive(stuck.child.pid)).toBe(false);
  }, 20_000);

  test("a stale pidfile signals nothing and reports live groups", async () => {
    const child = Bun.spawn(["bun", "-e", "await Bun.sleep(60_000)"], {
      detached: true,
      stdio: ["ignore", "ignore", "ignore"],
    });
    const path = join(dir, "stale.json");
    await writeRecord(
      {
        pid: 2_147_483_000,
        command: "bun scripts/frevo.ts",
        cwd: dir,
        groups: [child.pid],
        startedAt: new Date().toISOString(),
      },
      path
    );
    const result = await stopRecorded({ path });
    expect(result.stopped).toBe(false);
    expect(result.leftovers).toEqual([child.pid]);
    expect(isAlive(child.pid)).toBe(true);
    process.kill(-child.pid, "SIGKILL");
    await child.exited;
  }, 20_000);
});
