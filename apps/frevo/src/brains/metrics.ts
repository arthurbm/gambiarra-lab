// What the panel shows about each model: decisions, failures and response
// time. The hub's `llm.complete` and `llm.error` events are the source, tied
// to the call that caused them by the participant the scheduler chose: the hub
// serves one request at a time per participant and emits in order, so the
// oldest call of a participant still without an event is the one an event
// belongs to. The hub's event stream drops (Bun closes idle connections), so
// every call also counts from the caller's side and an event only refines it.
import type { Price } from "../models/catalog";

export interface Usage {
  /** What the provider charged, when it says so (OpenRouter's `usage.cost`). */
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface AttemptOutcome {
  /** False when the hub refused before dispatching (busy, gone): no event comes. */
  dispatched: boolean;
  durationMs: number;
  /** HTTP status of the answer; 0 when none came. */
  status: number;
  usage?: Usage;
  /** The answer held a decision that passed the tool's schema. */
  valid: boolean;
}

export interface HubLlmEvent {
  metrics?: {
    durationMs?: number;
    inputTokens?: number;
    outputTokens?: number;
  };
  participantId: string;
  type: "llm.complete" | "llm.error";
}

export interface ModelStats {
  /** Mean response time in ms, from the hub when its event arrived. */
  avgMs: number | null;
  decisions: number;
  failures: number;
  /** Calls whose numbers came from a hub event. */
  fromEvents: number;
  inFlight: number;
  model: string;
}

interface Attempt {
  endedAt?: number;
  event?: HubLlmEvent;
  model: string;
  outcome?: AttemptOutcome;
  participantId: string;
}

export interface ModelMetrics {
  begin: (participantId: string, model: string) => number;
  end: (attempt: number, outcome: AttemptOutcome) => void;
  observe: (event: HubLlmEvent) => void;
  reset: () => void;
  spendingUsd: () => number;
  stats: () => ModelStats[];
  /** The hub's stream (re)opened: events of calls already answered are lost. */
  streamOpened: () => void;
}

/** Ended calls kept waiting for a late event before they are given up on. */
const EVENT_GRACE_MS = 60_000;

export function createModelMetrics(options: {
  now?: () => number;
  price: (model: string) => Price | undefined;
}): ModelMetrics {
  const now = options.now ?? Date.now;
  const attempts = new Map<number, Attempt>();
  /** Per participant, the calls still without their event, oldest first. */
  const awaiting = new Map<string, number[]>();
  let nextId = 0;
  let spending = 0;

  function unwait(participantId: string, id: number) {
    const queue = awaiting.get(participantId);
    const index = queue?.indexOf(id) ?? -1;
    if (queue && index >= 0) {
      queue.splice(index, 1);
    }
  }

  function forgetStale() {
    const cutoff = now() - EVENT_GRACE_MS;
    for (const queue of awaiting.values()) {
      while (queue.length > 0) {
        const attempt = attempts.get(queue[0] as number);
        if (!(attempt?.endedAt !== undefined && attempt.endedAt < cutoff)) {
          break;
        }
        queue.shift();
      }
    }
  }

  function cost(attempt: Attempt): number {
    const usage = attempt.outcome?.usage;
    const input = usage?.inputTokens ?? attempt.event?.metrics?.inputTokens;
    const output = usage?.outputTokens ?? attempt.event?.metrics?.outputTokens;
    const price = options.price(attempt.model);
    const estimate = price
      ? ((input ?? 0) * price.input + (output ?? 0) * price.output) / 1e6
      : 0;
    return Math.max(estimate, usage?.costUsd ?? 0);
  }

  return {
    begin(participantId, model) {
      nextId += 1;
      attempts.set(nextId, { participantId, model });
      const queue = awaiting.get(participantId) ?? [];
      queue.push(nextId);
      awaiting.set(participantId, queue);
      return nextId;
    },
    end(id, outcome) {
      const attempt = attempts.get(id);
      if (!attempt || attempt.outcome) {
        return;
      }
      attempt.outcome = outcome;
      attempt.endedAt = now();
      if (!outcome.dispatched) {
        unwait(attempt.participantId, id);
        attempts.delete(id);
        return;
      }
      forgetStale();
      // Tokens from a late event are not added again; the answer's usage is
      // what OpenRouter returns and the hub copies it into its event anyway.
      spending += cost(attempt);
    },
    observe(event) {
      const queue = awaiting.get(event.participantId);
      const id = queue?.shift();
      const attempt = id === undefined ? undefined : attempts.get(id);
      if (attempt) {
        attempt.event = event;
      }
    },
    streamOpened() {
      const at = now();
      for (const [participantId, queue] of awaiting) {
        awaiting.set(
          participantId,
          queue.filter((id) => {
            const endedAt = attempts.get(id)?.endedAt;
            return endedAt === undefined || endedAt > at;
          })
        );
      }
    },
    reset() {
      attempts.clear();
      awaiting.clear();
      spending = 0;
    },
    spendingUsd: () => spending,
    stats() {
      const byModel = new Map<
        string,
        ModelStats & { timed: number; totalMs: number }
      >();
      for (const attempt of attempts.values()) {
        const row = byModel.get(attempt.model) ?? {
          model: attempt.model,
          decisions: 0,
          failures: 0,
          avgMs: null,
          inFlight: 0,
          fromEvents: 0,
          timed: 0,
          totalMs: 0,
        };
        byModel.set(attempt.model, row);
        const { outcome, event } = attempt;
        if (!outcome) {
          row.inFlight += 1;
          continue;
        }
        if (event) {
          row.fromEvents += 1;
        }
        if (outcome.valid && event?.type !== "llm.error") {
          row.decisions += 1;
        } else {
          row.failures += 1;
        }
        const durationMs = event?.metrics?.durationMs ?? outcome.durationMs;
        if (event || outcome.status !== 0) {
          row.timed += 1;
          row.totalMs += durationMs;
        }
      }
      return [...byModel.values()]
        .sort((a, b) => a.model.localeCompare(b.model))
        .map(({ timed, totalMs, ...row }) => ({
          ...row,
          avgMs: timed > 0 ? Math.round(totalMs / timed) : null,
        }));
    },
  };
}
