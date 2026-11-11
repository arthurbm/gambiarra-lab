// The pidfile of `frevo:dev`, one per worktree, and how `frevo:stop` ends
// exactly that run: SIGTERM to the parent (which stops its children in order),
// and SIGKILL to the parent and the process groups it recorded only when it
// does not exit in time. Nothing is matched by name, so another worktree's
// `frevo:dev` is never touched.
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

export const PIDFILE = resolve(import.meta.dir, "..", ".frevo-dev.json");

export interface DevRecord {
  /** The parent's command line as `ps` shows it, checked before any signal. */
  command: string;
  cwd: string;
  /** Process group leaders of the children (hub, world, model host, web). */
  groups: number[];
  pid: number;
  startedAt: string;
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, but someone else's; not ours to signal either way.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function groupAlive(pgid: number): boolean {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The command line of a running process, or "" when it is gone. */
export function commandOf(pid: number): string {
  const result = Bun.spawnSync(["ps", "-o", "command=", "-p", String(pid)], {
    stdout: "pipe",
    stderr: "ignore",
  });
  return result.exitCode === 0 ? result.stdout.toString().trim() : "";
}

export async function readRecord(path = PIDFILE): Promise<DevRecord | null> {
  try {
    return (await Bun.file(path).json()) as DevRecord;
  } catch {
    return null;
  }
}

export async function writeRecord(
  record: DevRecord,
  path = PIDFILE
): Promise<void> {
  await Bun.write(path, `${JSON.stringify(record, null, 2)}\n`);
}

/** Removes the pidfile only while it still names `pid`. */
export async function removeRecord(pid: number, path = PIDFILE): Promise<void> {
  const record = await readRecord(path);
  if (record?.pid === pid) {
    await rm(path, { force: true });
  }
}

async function waitGone(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) {
      return true;
    }
    // biome-ignore lint/performance/noAwaitInLoops: polling one process.
    await Bun.sleep(100);
  }
  return !isAlive(pid);
}

export interface StopResult {
  /** Groups left alive from a run whose parent was already gone. */
  leftovers: number[];
  message: string;
  stopped: boolean;
}

export async function stopRecorded(
  options: { path?: string; timeoutMs?: number } = {}
): Promise<StopResult> {
  const path = options.path ?? PIDFILE;
  const record = await readRecord(path);
  if (!record) {
    return {
      stopped: false,
      leftovers: [],
      message: `no frevo:dev recorded in ${path}`,
    };
  }
  const running = isAlive(record.pid);
  const same = running && commandOf(record.pid) === record.command;
  if (!same) {
    // The parent is gone (or its pid now belongs to something else): the
    // groups it recorded may have been reused, so they are only reported.
    const leftovers = record.groups.filter(groupAlive);
    await rm(path, { force: true });
    return {
      stopped: false,
      leftovers,
      message:
        leftovers.length > 0
          ? `frevo:dev (pid ${record.pid}) is gone, but process groups ${leftovers.join(", ")} are alive; check them with ps -o pid,command -g <group> before killing anything`
          : `frevo:dev (pid ${record.pid}) was not running; removed the stale pidfile`,
    };
  }
  process.kill(record.pid, "SIGTERM");
  let forced = false;
  if (!(await waitGone(record.pid, options.timeoutMs ?? 15_000))) {
    forced = true;
    try {
      process.kill(record.pid, "SIGKILL");
    } catch {
      // Gone meanwhile.
    }
  }
  for (const group of record.groups.filter(groupAlive)) {
    forced = true;
    try {
      process.kill(-group, "SIGKILL");
    } catch {
      // Gone meanwhile.
    }
  }
  await rm(path, { force: true });
  return {
    stopped: true,
    leftovers: [],
    message: forced
      ? `stopped frevo:dev (pid ${record.pid}), forcing what did not exit in time`
      : `stopped frevo:dev (pid ${record.pid}) and its children`,
  };
}
