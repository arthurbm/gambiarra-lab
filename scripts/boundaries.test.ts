// The repository's documented boundaries (AGENTS.md, apps/frevo/README.md),
// checked by looking at the files: each failure names the rule and the file.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|[^:"'`\\])\/\/.*$/gm;
const TEST_FILE = /\.test\.tsx?$/;
const SIM_BANNED: [string, RegExp][] = [
  ["Date.now", /\bDate\.now\b/],
  ["new Date(", /\bnew\s+Date\s*\(/],
  ["Math.random", /\bMath\.random\b/],
  ["fetch(", /\bfetch\s*\(/],
  ["setTimeout", /\bsetTimeout\b/],
  ["setInterval", /\bsetInterval\b/],
  ["process.env", /\bprocess\.env\b/],
  ["Bun.", /\bBun\./],
];
// A read of the key: env.OPENROUTER_API_KEY, env["OPENROUTER_API_KEY"], or
// destructuring it from an env. Scripts get the key through the model host's
// configuration (apps/frevo/src/model-host/config.ts).
const KEY_READS = [
  /\.\s*OPENROUTER_API_KEY\b(?!_)/,
  /\[\s*["'`]OPENROUTER_API_KEY["'`]\s*\]/,
  /\{[^}]*\bOPENROUTER_API_KEY\b(?!_)[^}]*\}\s*=\s*(?:process|Bun|import\.meta)\.env/,
];
const SKIP = /(^|\/)(node_modules|dist|\.turbo)\//;

function files(pattern: string, cwd = ROOT): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd, dot: false })]
    .filter((path) => !SKIP.test(path))
    .map((path) => join(cwd, path))
    .sort();
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

function rel(path: string): string {
  return relative(ROOT, path);
}

/** Drops comments, so a sentence about `Date.now` is not a use of it. */
function code(source: string): string {
  return source.replace(BLOCK_COMMENT, "").replace(LINE_COMMENT, "$1");
}

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|^\s*import\s+|\brequire\s*\(\s*)["'`]([^"'`]+)["'`]/gm;

function specifiers(source: string): string[] {
  return [...code(source).matchAll(SPECIFIER)].map((match) => match[1] ?? "");
}

function isTest(path: string): boolean {
  return TEST_FILE.test(path);
}

describe("boundaries", () => {
  test("apps/frevo/src/sim is pure: no clock, randomness, I/O or imports from outside it", () => {
    const sim = join(ROOT, "apps/frevo/src/sim");
    const broken: string[] = [];
    for (const path of files("**/*.{ts,tsx}", sim).filter((p) => !isTest(p))) {
      const source = read(path);
      for (const [name, pattern] of SIM_BANNED) {
        if (pattern.test(code(source))) {
          broken.push(`${rel(path)} uses ${name}`);
        }
      }
      for (const specifier of specifiers(source)) {
        if (!specifier.startsWith("./")) {
          broken.push(`${rel(path)} imports "${specifier}"`);
        }
      }
    }
    expect(
      broken,
      "The simulation is pure (apps/frevo/README.md, Modules): no real clock, no randomness but the seeded generator in the state, no I/O, and imports only from ./"
    ).toEqual([]);
  });

  test("packages/agents imports nothing from apps/ (AGENTS.md rule 4)", () => {
    const apps = files("apps/*/package.json").map(
      (path) => (JSON.parse(read(path)) as { name: string }).name
    );
    const agents = join(ROOT, "packages/agents");
    const broken: string[] = [];
    for (const path of files("**/*.{ts,tsx,js,mjs}", agents)) {
      for (const specifier of specifiers(read(path))) {
        const target = specifier.startsWith(".")
          ? rel(resolve(dirname(path), specifier))
          : "";
        const app = apps.find(
          (name) => specifier === name || specifier.startsWith(`${name}/`)
        );
        if (target.startsWith("apps/") || app) {
          broken.push(`${rel(path)} imports "${specifier}"`);
        }
      }
    }
    const manifest = JSON.parse(read(join(agents, "package.json"))) as Record<
      string,
      Record<string, string> | undefined
    >;
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      for (const name of Object.keys(manifest[field] ?? {})) {
        if (apps.includes(name)) {
          broken.push(`packages/agents/package.json ${field} has ${name}`);
        }
      }
    }
    expect(
      broken,
      "AGENTS.md rule 4: packages/agents knows nothing about the apps; no import from apps/*"
    ).toEqual([]);
  });

  test("every workspace package is private (AGENTS.md rule 2)", () => {
    const manifests = files("{apps,packages}/*/package.json");
    expect(manifests.length).toBeGreaterThan(0);
    const broken = manifests
      .filter(
        (path) =>
          (JSON.parse(read(path)) as { private?: unknown }).private !== true
      )
      .map(rel);
    expect(
      broken,
      'AGENTS.md rule 2: nothing is published to npm while it has a single consumer; every package.json under apps/ and packages/ has "private": true'
    ).toEqual([]);
  });

  test("OPENROUTER_API_KEY is read only in apps/frevo/src/model-host", () => {
    const allowed = "apps/frevo/src/model-host/";
    const broken = files(
      "{apps,packages,scripts,deploy,.railway}/**/*.{ts,tsx,js,mjs}"
    )
      .concat(files(".railway/*.ts"))
      .filter((path) => !rel(path).startsWith(allowed))
      .filter((path) => {
        const source = code(read(path));
        return KEY_READS.some((pattern) => pattern.test(source));
      })
      .map(rel);
    expect(
      [...new Set(broken)],
      "AGENTS.md rule 6: the inference provider's key exists only in the model host; read it through apps/frevo/src/model-host/config.ts"
    ).toEqual([]);
  });
});
