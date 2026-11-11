/** Reads a server-sent event stream as parsed `data:` payloads. */
export async function openEventStream<T>(url: string) {
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream" },
    signal: abort.signal,
  });
  if (!(response.ok && response.body)) {
    throw new Error(`${url} answered ${response.status}`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = "";
  const queued: T[] = [];

  async function next(): Promise<T> {
    for (;;) {
      const ready = queued.shift();
      if (ready !== undefined) {
        return ready;
      }
      // biome-ignore lint/performance/noAwaitInLoops: reads the stream one chunk at a time.
      const { done, value } = await reader.read();
      if (done) {
        throw new Error("the event stream ended");
      }
      pending += value;
      const blocks = pending.split("\n\n");
      pending = blocks.pop() ?? "";
      for (const block of blocks) {
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) {
          queued.push(JSON.parse(data) as T);
        }
      }
    }
  }

  return {
    contentType: response.headers.get("content-type"),
    next,
    /** Reads events until one satisfies `match`, or throws after `timeoutMs`. */
    async find(match: (event: T) => boolean, timeoutMs = 15_000): Promise<T> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        // biome-ignore lint/performance/noAwaitInLoops: events arrive in order.
        const event = await next();
        if (match(event)) {
          return event;
        }
        if (Date.now() > deadline) {
          throw new Error(`no matching event within ${timeoutMs}ms`);
        }
      }
    },
    close: () => abort.abort(),
  };
}
