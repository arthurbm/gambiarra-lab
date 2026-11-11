// The production build, as the world serves it on the public deploy: the
// telão's demo (fake bonecos for rehearsing the layout) is not in it.
import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("the production build leaves the telão's demo out", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "frevo-web-build-"));
  try {
    const build = Bun.spawn(
      ["bun", "x", "vite", "build", "--outDir", outDir, "--emptyOutDir"],
      {
        cwd: resolve(import.meta.dir, ".."),
        // bun test sets NODE_ENV=test, which Vite would build as development.
        env: { ...process.env, NODE_ENV: "production" },
        stdout: "ignore",
        stderr: "pipe",
      }
    );
    expect(await build.exited).toBe(0);
    const assets = join(outDir, "assets");
    const scripts = (await readdir(assets)).filter((name) =>
      name.endsWith(".js")
    );
    expect(scripts.length).toBeGreaterThan(0);
    for (const name of scripts) {
      // biome-ignore lint/performance/noAwaitInLoops: a handful of files.
      const code = await Bun.file(join(assets, name)).text();
      expect({ name, demo: code.includes("/telao/demo") }).toEqual({
        name,
        demo: false,
      });
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
}, 60_000);
