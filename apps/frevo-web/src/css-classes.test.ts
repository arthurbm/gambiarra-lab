// Every class name written literally in a .tsx has a rule in one of the app's
// .css files. A merge once dropped a whole screen's CSS and no test noticed;
// this one lists the classes left without a rule.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = import.meta.dir;

/**
 * Classes used on purpose without a rule of their own. Keep it short and say
 * why for each one.
 */
const NO_RULE_NEEDED = new Set<string>([]);

const CLASS_NAME = /^-?[_a-zA-Z][\w-]*$/;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_STRING = /url\([^)]*\)|"[^"]*"|'[^']*'/g;
const CSS_CLASS = /\.(-?[_a-zA-Z][\w-]*)/g;
const CLASS_ATTRIBUTE = /\bclassName\s*=\s*/g;
const LITERAL = /"([^"\\]*)"|'([^'\\]*)'|`([^`]*)`/g;
const INTERPOLATION = /\$\{[^}]*\}/g;
const SPACES = /\s+/;

function sources(pattern: string): string[] {
  return [...new Bun.Glob(pattern).scanSync({ cwd: SRC })]
    .map((path) => join(SRC, path))
    .sort();
}

/** Every class a selector in the app's CSS names. */
export function cssClasses(css: string): Set<string> {
  const plain = css.replace(BLOCK_COMMENT, "").replace(CSS_STRING, "");
  return new Set([...plain.matchAll(CSS_CLASS)].map((match) => match[1] ?? ""));
}

/** The expression after `className=`: a string, or a balanced `{...}`. */
function attributeValue(source: string, start: number): string {
  const first = source[start];
  if (first === '"' || first === "'") {
    const end = source.indexOf(first, start + 1);
    return source.slice(start, end + 1);
  }
  if (first !== "{") {
    return "";
  }
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }
  return "";
}

/**
 * Class names written literally in className: the attribute's string, and the
 * string and template literals inside its expression (a ternary, a list
 * joined with spaces). A word glued to `${...}` is a computed name and skipped.
 */
export function usedClasses(tsx: string): Set<string> {
  const found = new Set<string>();
  for (const match of tsx.matchAll(CLASS_ATTRIBUTE)) {
    const value = attributeValue(tsx, (match.index ?? 0) + match[0].length);
    for (const literal of value.matchAll(LITERAL)) {
      const text = literal[1] ?? literal[2] ?? literal[3] ?? "";
      // A word glued to an interpolation keeps the marker and fails the test.
      for (const word of text.replace(INTERPOLATION, "\u0000").split(SPACES)) {
        if (CLASS_NAME.test(word)) {
          found.add(word);
        }
      }
    }
  }
  return found;
}

describe("CSS classes", () => {
  test("the collector reads attributes, ternaries, joined lists and templates", () => {
    expect([
      ...usedClasses(
        `<div className="a b" /><p className={on ? "c" : undefined} /><i className={["d", x].join(" ")} /><b className={\`e f-\${x} g\`} />`
      ),
    ]).toEqual(["a", "b", "c", "d", "e", "g"]);
    expect([
      ...cssClasses(
        ".a, .b:hover > .c { background: url(x.png) } /* .z */ @media (x) { .d { opacity: .5 } }"
      ),
    ]).toEqual(["a", "b", "c", "d"]);
  });

  test("every literal class in the .tsx files has a rule in the app's .css", () => {
    const defined = new Set<string>();
    for (const path of sources("**/*.css")) {
      for (const name of cssClasses(readFileSync(path, "utf8"))) {
        defined.add(name);
      }
    }
    const orphans: string[] = [];
    for (const path of sources("**/*.tsx")) {
      for (const name of usedClasses(readFileSync(path, "utf8"))) {
        if (!(defined.has(name) || NO_RULE_NEEDED.has(name))) {
          orphans.push(`${relative(SRC, path)}: .${name}`);
        }
      }
    }
    expect(
      orphans,
      "Classes used in a .tsx with no rule in any .css of apps/frevo-web/src: add the rule, remove the class, or list it in NO_RULE_NEEDED with the reason"
    ).toEqual([]);
  });
});
