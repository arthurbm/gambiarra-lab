import type { Clock } from "../brains/scheduler";

/** A clock that only moves when the test says so. */
export function fakeClock(start = 0) {
  let now = start;
  let nextHandle = 0;
  const timers = new Map<number, { at: number; run: () => void }>();

  const clock: Clock = {
    now: () => now,
    setTimeout(run, ms) {
      nextHandle += 1;
      timers.set(nextHandle, { at: now + ms, run });
      return nextHandle;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
  };

  /** Lets pending promise callbacks run. */
  async function flush() {
    for (let round = 0; round < 10; round += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: each round lets one more layer of callbacks run.
      await Promise.resolve();
    }
  }

  return {
    clock,
    flush,
    /** Moves time forward, firing every timer that falls due, in order. */
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        now = due[1].at;
        due[1].run();
        // biome-ignore lint/performance/noAwaitInLoops: a timer's callbacks settle before the next fires.
        await flush();
      }
      now = target;
      await flush();
    },
  };
}
