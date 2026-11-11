#!/usr/bin/env bun
// Runs one heavy command (the test battery, a smoke, a load test) at a time
// per machine, across every worktree: it takes an exclusive lock on a file
// outside the repository, waits its turn telling stderr who holds it, then
// runs the command with its arguments and exits with its code.
//
//   bun scripts/heavy.ts <command> [args...]
//
// The lock is flock(2) through bun:ffi, on Linux and macOS alike (the macOS
// `flock` command does not exist, the system call does). The kernel drops it
// when the process dies, so a run killed by the OOM killer leaves no stale lock.
// GAMBIARRA_HEAVY_LOCK moves the file (default ~/.cache/gambiarra-lab/heavy.lock).
// A heavy command started by another one under the same lock runs at once.
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const LOCK_EX = 2;
const LOCK_NB = 4;
// LOCK_EX | LOCK_NB, written out so the linter does not read it as a typo of ||.
const LOCK_EX_NB = LOCK_EX + LOCK_NB;
const HELD_ENV = "GAMBIARRA_HEAVY_LOCK_HELD";
const POLL_MS = 500;

export function lockPath(env: Record<string, string | undefined>): string {
  return (
    env.GAMBIARRA_HEAVY_LOCK ||
    join(homedir(), ".cache", "gambiarra-lab", "heavy.lock")
  );
}

type Flock = (fd: number, operation: number) => number;

async function loadFlock(): Promise<Flock> {
  const { dlopen, FFIType } = await import("bun:ffi");
  const library =
    process.platform === "darwin" ? "/usr/lib/libSystem.B.dylib" : "libc.so.6";
  const { symbols } = dlopen(library, {
    flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 },
  });
  return (fd, operation) => symbols.flock(fd, operation) as number;
}

function holder(path: string): string {
  try {
    return readFileSync(path, "utf8").trim() || "unknown";
  } catch {
    return "unknown";
  }
}

/** Blocks until this process holds the lock; returns the file descriptor. */
export async function acquire(
  path: string,
  command: string[],
  log: (line: string) => void = (line) => process.stderr.write(`${line}\n`)
): Promise<number> {
  mkdirSync(dirname(path), { recursive: true });
  const flock = await loadFlock();
  const fd = openSync(path, "a+");
  let told = "";
  while (flock(fd, LOCK_EX_NB) !== 0) {
    const current = holder(path);
    if (current !== told) {
      log(`[heavy] waiting for the lock ${path}, held by: ${current}`);
      told = current;
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling one lock.
    await Bun.sleep(POLL_MS);
  }
  if (told) {
    log("[heavy] got the lock");
  }
  // A second descriptor rewrites the file; flock stays on the first one.
  const owner = openSync(path, "w");
  writeSync(
    owner,
    `pid ${process.pid}, ${process.cwd()}, \`${command.join(" ")}\`, since ${new Date().toISOString()}\n`
  );
  closeSync(owner);
  return fd;
}

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0) {
    process.stderr.write("usage: bun scripts/heavy.ts <command> [args...]\n");
    return 2;
  }
  const path = lockPath(process.env);
  if (process.env[HELD_ENV] !== path) {
    try {
      await acquire(path, argv);
    } catch (error) {
      // No flock here (no bun:ffi, an unknown libc): run, but say so.
      process.stderr.write(
        `[heavy] could not take the lock (${error instanceof Error ? error.message : String(error)}); running without it\n`
      );
    }
  }
  const child = Bun.spawn(argv, {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, [HELD_ENV]: path },
  });
  const forward = (signal: NodeJS.Signals) => () => child.kill(signal);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  const code = await child.exited;
  return child.signalCode ? 1 : code;
}

if (import.meta.main) {
  process.exit(await main(process.argv.slice(2)));
}
