#!/usr/bin/env bun
// Points the lab at a local gambi checkout until gambi 0.7.0 is published.
// `bun install` undoes the links; run `bun run link:gambi` again afterwards.
import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const labRoot = resolve(import.meta.dir, "..");
const gambiRoot = resolve(
  process.env.GAMBI_DIR ?? join(labRoot, "..", "gambi")
);
const sdkDir = join(gambiRoot, "packages", "sdk");
const cliEntry = join(gambiRoot, "packages", "cli", "src", "cli.ts");
const workspacesUsingSdk = [".", "apps/board", "packages/agents"];

if (!(await Bun.file(cliEntry).exists())) {
  console.error(
    `gambi checkout not found at ${gambiRoot}. Clone it next to this repo or set GAMBI_DIR.`
  );
  process.exit(1);
}

const build = Bun.spawnSync(["bun", "run", "build"], {
  cwd: sdkDir,
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) {
  console.error(
    "gambi-sdk build failed. Run `bun install` in the gambi checkout first."
  );
  process.exit(1);
}

for (const workspace of workspacesUsingSdk) {
  const target = join(labRoot, workspace, "node_modules", "gambi-sdk");
  await mkdir(join(labRoot, workspace, "node_modules"), { recursive: true });
  await rm(target, { recursive: true, force: true });
  await symlink(sdkDir, target, "dir");
}

const shim = join(labRoot, "node_modules", ".bin", "gambi");
await mkdir(join(labRoot, "node_modules", ".bin"), { recursive: true });
await rm(shim, { force: true });
await writeFile(shim, `#!/bin/sh\nexec bun "${cliEntry}" "$@"\n`);
await chmod(shim, 0o755);

console.log(`gambi-sdk -> ${sdkDir}`);
console.log(`gambi CLI -> ${cliEntry}`);
