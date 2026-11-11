import { describe, expect, test } from "bun:test";
import {
  connectTelaoStream,
  type EventSourceLike,
  type StreamStatus,
} from "./stream";

/** A hand-driven EventSource and clock. */
function harness() {
  const sources: FakeSource[] = [];
  const timers = new Map<number, { at: number; run: () => void }>();
  let now = 0;
  let nextTimer = 1;

  class FakeSource implements EventSourceLike {
    readonly url: string;
    readyState = 0;
    closed = false;
    onerror: (() => void) | null = null;
    private readonly listeners = new Map<
      string,
      (event: { data: string }) => void
    >();

    constructor(url: string) {
      this.url = url;
      sources.push(this);
    }

    addEventListener(
      type: string,
      listener: (event: { data: string }) => void
    ) {
      this.listeners.set(type, listener);
    }

    close() {
      this.closed = true;
      this.readyState = 2;
    }

    emit(snapshot: unknown) {
      this.readyState = 1;
      this.listeners.get("snapshot")?.({ data: JSON.stringify(snapshot) });
    }

    /** The browser gave up on this source (for example the server answered 502). */
    fail() {
      this.readyState = 2;
      this.onerror?.();
    }

    /** The connection dropped and the browser is retrying by itself. */
    drop() {
      this.readyState = 0;
      this.onerror?.();
    }
  }

  return {
    sources,
    createEventSource: (url: string) => new FakeSource(url),
    timers: {
      setTimeout: (run: () => void, ms: number) => {
        const id = nextTimer;
        nextTimer += 1;
        timers.set(id, { at: now + ms, run });
        return id;
      },
      clearTimeout: (id: number) => {
        timers.delete(id);
      },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now && timers.has(id)) {
          timers.delete(id);
          timer.run();
        }
      }
    },
    pendingTimers: () => timers.size,
  };
}

function connect(fake: ReturnType<typeof harness>) {
  const snapshots: unknown[] = [];
  const statuses: StreamStatus[] = [];
  const disconnect = connectTelaoStream<unknown, number>({
    url: "/events/telao",
    createEventSource: fake.createEventSource,
    timers: fake.timers,
    retryMs: 1000,
    staleMs: 5000,
    onSnapshot: (snapshot) => snapshots.push(snapshot),
    onStatus: (status) => statuses.push(status),
  });
  return { snapshots, statuses, disconnect };
}

describe("the telão stream", () => {
  test("delivers each snapshot and says it is live", () => {
    const fake = harness();
    const { snapshots, statuses } = connect(fake);

    expect(fake.sources).toHaveLength(1);
    expect(fake.sources[0]?.url).toBe("/events/telao");
    expect(statuses).toEqual(["connecting"]);

    fake.sources[0]?.emit({ timeMs: 100 });
    fake.sources[0]?.emit({ timeMs: 300 });
    expect(snapshots).toEqual([{ timeMs: 100 }, { timeMs: 300 }]);
    expect(statuses).toEqual(["connecting", "live"]);
  });

  test("opens a new connection when the browser gives up on the old one", () => {
    const fake = harness();
    const { snapshots, statuses } = connect(fake);
    fake.sources[0]?.emit({ timeMs: 100 });

    fake.sources[0]?.fail();
    expect(statuses.at(-1)).toBe("reconnecting");
    expect(fake.sources).toHaveLength(1);

    fake.advance(1000);
    expect(fake.sources).toHaveLength(2);
    expect(fake.sources[0]?.closed).toBe(true);

    fake.sources[1]?.emit({ timeMs: 900 });
    expect(snapshots.at(-1)).toEqual({ timeMs: 900 });
    expect(statuses.at(-1)).toBe("live");
  });

  test("lets the browser retry on its own after a drop, without a second connection", () => {
    const fake = harness();
    const { statuses } = connect(fake);
    fake.sources[0]?.emit({ timeMs: 100 });

    fake.sources[0]?.drop();
    expect(statuses.at(-1)).toBe("reconnecting");
    fake.advance(1000);
    expect(fake.sources).toHaveLength(1);

    fake.sources[0]?.emit({ timeMs: 500 });
    expect(statuses.at(-1)).toBe("live");
  });

  test("connects again when the stream goes silent", () => {
    const fake = harness();
    const { statuses } = connect(fake);
    fake.sources[0]?.emit({ timeMs: 100 });

    fake.advance(4000);
    fake.sources[0]?.emit({ timeMs: 4100 });
    fake.advance(4000);
    expect(fake.sources).toHaveLength(1);

    fake.advance(1000);
    expect(fake.sources).toHaveLength(2);
    expect(fake.sources[0]?.closed).toBe(true);
    expect(statuses.at(-1)).toBe("reconnecting");
  });

  test("keeps trying while the server stays down", () => {
    const fake = harness();
    connect(fake);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      fake.sources.at(-1)?.fail();
      fake.advance(1000);
    }
    expect(fake.sources).toHaveLength(5);
  });

  test("stops for good when disconnected", () => {
    const fake = harness();
    const { snapshots, disconnect } = connect(fake);
    fake.sources[0]?.emit({ timeMs: 100 });

    disconnect();
    expect(fake.sources[0]?.closed).toBe(true);
    expect(fake.pendingTimers()).toBe(0);

    fake.sources[0]?.emit({ timeMs: 200 });
    fake.advance(60_000);
    expect(snapshots).toEqual([{ timeMs: 100 }]);
    expect(fake.sources).toHaveLength(1);
  });
});
