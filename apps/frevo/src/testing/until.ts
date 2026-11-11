/** Polls until `check` returns a value, or throws after `timeoutMs`. */
export async function until<T>(
  check: () => Promise<T | undefined>,
  timeoutMs = 15_000,
  intervalMs = 50
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // biome-ignore lint/performance/noAwaitInLoops: polling waits for the previous check.
    const value = await check().catch(() => undefined);
    if (value !== undefined) {
      return value;
    }
    if (Date.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs}ms`);
    }
    await Bun.sleep(intervalMs);
  }
}
