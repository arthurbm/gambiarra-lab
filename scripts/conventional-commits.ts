#!/usr/bin/env bun
// AGENTS.md rule 5, checked on a pull request: its title (the squash commit
// it becomes) and every commit that is not a merge follow
// `type(scope)?: subject`. Merge commits are exempt.
//
//   bun scripts/conventional-commits.ts --title "<PR title>" --range <base>..<head>
//
// Exits 1 listing every subject that breaks the rule.

export const TYPES = [
  "build",
  "chore",
  "ci",
  "docs",
  "feat",
  "fix",
  "perf",
  "refactor",
  "revert",
  "style",
  "test",
];

const SUBJECT = new RegExp(
  `^(?:${TYPES.join("|")})(?:\\([a-z0-9][a-z0-9._/-]*\\))?!?: \\S`
);

export function isConventional(subject: string): boolean {
  return SUBJECT.test(subject);
}

/** Subjects of the non-merge commits in a range, oldest first. */
export function commitSubjects(range: string, cwd = process.cwd()): string[] {
  const result = Bun.spawnSync(
    ["git", "log", "--no-merges", "--reverse", "--format=%h %s", range],
    { cwd, stdout: "pipe", stderr: "pipe" }
  );
  if (result.exitCode !== 0) {
    throw new Error(`git log ${range} failed: ${result.stderr.toString()}`);
  }
  return result.stdout
    .toString()
    .split("\n")
    .filter((line) => line.length > 0);
}

export function violations(input: {
  commits: string[];
  title?: string;
}): string[] {
  const broken: string[] = [];
  if (input.title !== undefined && !isConventional(input.title)) {
    broken.push(`PR title: ${input.title}`);
  }
  for (const line of input.commits) {
    const subject = line.slice(line.indexOf(" ") + 1);
    if (!isConventional(subject)) {
      broken.push(`commit ${line}`);
    }
  }
  return broken;
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const title = option(args, "--title");
  const range = option(args, "--range");
  const broken = violations({
    title,
    commits: range ? commitSubjects(range) : [],
  });
  if (broken.length > 0) {
    console.error(
      `Conventional Commits (AGENTS.md rule 5): \`type(scope): subject\` with type one of ${TYPES.join(", ")}. PRs are squashed and the title becomes the commit; merge commits are exempt.`
    );
    for (const line of broken) {
      console.error(`  ${line}`);
    }
    process.exit(1);
  }
  console.log("Conventional Commits: ok");
}
