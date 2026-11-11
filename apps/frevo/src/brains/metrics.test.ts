import { describe, expect, test } from "bun:test";
import { createModelMetrics } from "./metrics";

const PRICES = {
  "modelo-a": { input: 1, output: 2 },
  "modelo-b": { input: 0.5, output: 0.5 },
};

function metricsAt(start = 1000) {
  let now = start;
  const metrics = createModelMetrics({
    now: () => now,
    price: (model) => PRICES[model as keyof typeof PRICES],
  });
  return {
    metrics,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ok = { dispatched: true, status: 200, valid: true } as const;

function complete(participantId: string, durationMs: number) {
  return {
    type: "llm.complete" as const,
    participantId,
    metrics: { durationMs, inputTokens: 100, outputTokens: 10 },
  };
}

describe("the models' metrics", () => {
  test("count decisions, failures and the hub's response time per model", () => {
    const { metrics, advance } = metricsAt();
    const first = metrics.begin("frevo-a-1", "modelo-a");
    advance(900);
    metrics.observe(complete("frevo-a-1", 800));
    metrics.end(first, { ...ok, durationMs: 900 });

    const second = metrics.begin("frevo-a-1", "modelo-a");
    advance(500);
    metrics.observe(complete("frevo-a-1", 400));
    metrics.end(second, { ...ok, valid: false, durationMs: 500 });

    const third = metrics.begin("frevo-b-1", "modelo-b");
    metrics.observe({
      type: "llm.error",
      participantId: "frevo-b-1",
    });
    metrics.end(third, {
      dispatched: true,
      status: 502,
      valid: false,
      durationMs: 30,
    });

    expect(metrics.stats()).toEqual([
      {
        model: "modelo-a",
        decisions: 1,
        failures: 1,
        avgMs: 600,
        inFlight: 0,
        fromEvents: 2,
      },
      {
        model: "modelo-b",
        decisions: 0,
        failures: 1,
        avgMs: 30,
        inFlight: 0,
        fromEvents: 1,
      },
    ]);
  });

  test("show what is still waiting for an answer", () => {
    const { metrics } = metricsAt();
    metrics.begin("frevo-a-1", "modelo-a");
    expect(metrics.stats()).toEqual([
      {
        model: "modelo-a",
        decisions: 0,
        failures: 0,
        avgMs: null,
        inFlight: 1,
        fromEvents: 0,
      },
    ]);
  });

  test("keep counting from the caller's side while the hub's stream is down", () => {
    const { metrics, advance } = metricsAt();
    // The stream drops: this attempt's event never arrives.
    const lost = metrics.begin("frevo-a-1", "modelo-a");
    advance(700);
    metrics.end(lost, { ...ok, durationMs: 700 });
    // The stream comes back; the next attempt's event must not be taken for
    // the lost one.
    advance(100);
    metrics.streamOpened();
    const next = metrics.begin("frevo-a-1", "modelo-a");
    advance(300);
    metrics.observe(complete("frevo-a-1", 250));
    metrics.end(next, { ...ok, valid: false, durationMs: 300 });

    expect(metrics.stats()).toEqual([
      {
        model: "modelo-a",
        decisions: 1,
        failures: 1,
        avgMs: 475,
        inFlight: 0,
        fromEvents: 1,
      },
    ]);
  });

  test("leave out calls the hub refused before dispatching", () => {
    const { metrics } = metricsAt();
    const refused = metrics.begin("frevo-a-1", "modelo-a");
    metrics.end(refused, {
      dispatched: false,
      status: 409,
      valid: false,
      durationMs: 2,
    });
    const answered = metrics.begin("frevo-a-1", "modelo-a");
    metrics.observe(complete("frevo-a-1", 100));
    metrics.end(answered, { ...ok, durationMs: 110 });

    expect(metrics.stats()).toEqual([
      {
        model: "modelo-a",
        decisions: 1,
        failures: 0,
        avgMs: 100,
        inFlight: 0,
        fromEvents: 1,
      },
    ]);
  });

  test("estimate spending from the reported tokens, or the provider's cost when it is higher", () => {
    const { metrics } = metricsAt();
    const a = metrics.begin("frevo-a-1", "modelo-a");
    metrics.end(a, {
      ...ok,
      durationMs: 10,
      usage: { inputTokens: 1000, outputTokens: 100 },
    });
    const b = metrics.begin("frevo-b-1", "modelo-b");
    metrics.end(b, {
      ...ok,
      durationMs: 10,
      usage: { inputTokens: 1000, outputTokens: 100, costUsd: 0.01 },
    });
    // 1000 * 1 / 1e6 + 100 * 2 / 1e6 = 0.0012, plus the reported 0.01.
    expect(metrics.spendingUsd()).toBeCloseTo(0.0112, 10);

    metrics.reset();
    expect(metrics.spendingUsd()).toBe(0);
    expect(metrics.stats()).toEqual([]);
  });

  test("take the tokens from the hub's event when the answer did not report them", () => {
    const { metrics } = metricsAt();
    const a = metrics.begin("frevo-a-1", "modelo-a");
    metrics.observe(complete("frevo-a-1", 100));
    metrics.end(a, { ...ok, durationMs: 110 });
    // 100 * 1 / 1e6 + 10 * 2 / 1e6
    expect(metrics.spendingUsd()).toBeCloseTo(0.000_12, 10);
  });
});
