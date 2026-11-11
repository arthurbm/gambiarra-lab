import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "heavy-lock-"));
const lock = join(dir, "heavy.lock");
const launcher = join(import.meta.dir, "heavy.ts");

afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Runs the launcher with its own lock file, outside the suite's lock. */
function launch(args: string[]) {
  const env: Record<string, string> = { ...process.env } as Record<
    string,
    string
  >;
  env.GAMBIARRA_HEAVY_LOCK = lock;
  env.GAMBIARRA_HEAVY_LOCK_HELD = "";
  return Bun.spawn(["bun", launcher, ...args], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

/** A command that writes when it starts and ends, holding for `ms`. */
function sleeper(name: string, ms: number): string[] {
  const out = join(dir, `${name}.txt`);
  return [
    "bun",
    "-e",
    `const fs=require("node:fs");fs.writeFileSync(${JSON.stringify(out)},Date.now()+"\\n");await Bun.sleep(${ms});fs.appendFileSync(${JSON.stringify(out)},Date.now()+"\\n");`,
  ];
}

function interval(name: string): [number, number] {
  const [start, end] = readFileSync(join(dir, `${name}.txt`), "utf8")
    .trim()
    .split("\n")
    .map(Number);
  return [start ?? 0, end ?? 0];
}

describe("heavy launcher", () => {
  test("two launches at once do not overlap, and the second says who holds the lock", async () => {
    const first = launch(sleeper("a", 1200));
    const second = launch(sleeper("b", 1200));
    const [codeA, codeB] = await Promise.all([first.exited, second.exited]);
    expect([codeA, codeB]).toEqual([0, 0]);
    const [a, b] = [interval("a"), interval("b")];
    const [early, late] = a[0] < b[0] ? [a, b] : [b, a];
    expect(late[0]).toBeGreaterThanOrEqual(early[1]);
    const stderr =
      (await new Response(first.stderr).text()) +
      (await new Response(second.stderr).text());
    expect(stderr).toContain("held by: pid");
  }, 20_000);

  test("passes arguments and the exit code through", async () => {
    const child = launch([
      "bun",
      "-e",
      "process.exit(Number(process.argv[1]))",
      "7",
    ]);
    expect(await child.exited).toBe(7);
  }, 20_000);

  test("runs at once when the lock is already held by its parent", async () => {
    const env: Record<string, string> = { ...process.env } as Record<
      string,
      string
    >;
    env.GAMBIARRA_HEAVY_LOCK = lock;
    const outer = Bun.spawn(
      [
        "bun",
        launcher,
        "bun",
        launcher,
        "bun",
        "-e",
        "console.log('inner ran')",
      ],
      { env, stdout: "pipe", stderr: "pipe" }
    );
    expect(await outer.exited).toBe(0);
    expect(await new Response(outer.stdout).text()).toContain("inner ran");
  }, 20_000);
});
