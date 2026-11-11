// The brain scheduler. It takes the decisions the simulation asked for, picks
// a free model participant of the Room, calls the inference plane and hands
// the action back. The hub serves one request at a time per participant,
// refuses a busy one (409) and never says who answered, so the choice of
// participant is made here, and a participant stays busy until the hub
// answered: aborting the call on this side would not free it on the hub.
import { modelEntry } from "../models/catalog";
import type { BrainResult, DecisionRequest } from "../sim/world";
import {
  type ChatMessage,
  decisionMessages,
  decisionTool,
  type FunctionTool,
  parseDecision,
} from "./decision";
import { createModelMetrics, type ModelMetrics, type Usage } from "./metrics";
import { toolArguments } from "./validate";

export interface RoomParticipant {
  /** The hub listed it as busy (only used to clear a participant left behind). */
  busy?: boolean;
  id: string;
  /** The model behind the participant, as shown to people. */
  model: string;
}

export interface ChatCompletionBody {
  max_tokens: number;
  messages: ChatMessage[];
  /** Always a participant id: the scheduler chooses who answers. */
  model: string;
  stream: false;
  /** With a single tool, "required" forces it on every provider. */
  tool_choice: "required";
  tools: FunctionTool[];
}

/** One non-streaming chat/completions call to a participant; resolves with the JSON body. */
export type Inference = (
  participantId: string,
  body: ChatCompletionBody,
  signal: AbortSignal
) => Promise<unknown>;

export interface Clock {
  clearTimeout: (handle: unknown) => void;
  now: () => number;
  setTimeout: (run: () => void, ms: number) => unknown;
}

const REAL_CLOCK: Clock = {
  now: () => Date.now(),
  setTimeout: (run, ms) => setTimeout(run, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface AvailableModel {
  enabled: boolean;
  model: string;
  /** Participants of this model in the Room. */
  participants: number;
}

export interface Budget {
  ceilingUsd: number;
  exceeded: boolean;
  spentUsd: number;
}

export interface BrainScheduler {
  budget: () => Budget;
  /** Results that settled since the last call. */
  drain: () => BrainResult[];
  metrics: ModelMetrics;
  /** The models in the Room, for the admin and for assigning bonecos. */
  models: () => AvailableModel[];
  /** Starts the session's spending from zero. */
  resetBudget: () => void;
  setModelEnabled: (model: string, enabled: boolean) => void;
  /** The model participants that can answer right now. */
  setParticipants: (participants: RoomParticipant[]) => void;
  submit: (request: DecisionRequest) => void;
}

export interface BrainSchedulerOptions {
  /** How long a hub call may take before it is given up on (and the participant left alone). */
  callTimeoutMs?: number;
  /** Session spending after which every boneco goes on autopilot. */
  ceilingUsd?: number;
  clock?: Clock;
  /** How long a decision waits for its own model before any free participant takes it. */
  fallbackMs?: number;
  infer: Inference;
  maxTokens?: number;
  metrics?: ModelMetrics;
  /** How long a request may wait and run before it is reported as failed. */
  requestTimeoutMs?: number;
}

/** Answers per request: the first, and one repeat when it comes back unusable. */
const ATTEMPTS = 2;
const HUB_REFUSAL =
  /already handling another request|No available participant|tunnel is not connected|Room not found/;

interface Queued {
  enqueuedAt: number;
  expire: unknown;
  /** Reported already (late or over budget); the answer, if any, is dropped. */
  finished: boolean;
  request: DecisionRequest;
}

/** The hub refused before dispatching, so the model never saw the request. */
function refusedByHub(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  if (
    typeof status === "number" &&
    [404, 409, 503].includes(status) &&
    HUB_REFUSAL.test(error instanceof Error ? error.message : "")
  ) {
    return status;
  }
}

function usageOf(completion: unknown): Usage | undefined {
  const usage = (completion as { usage?: Record<string, unknown> } | null)
    ?.usage;
  if (!usage) {
    return;
  }
  const number = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined;
  return {
    inputTokens: number(usage.prompt_tokens),
    outputTokens: number(usage.completion_tokens),
    costUsd: number(usage.cost),
  };
}

export function createBrainScheduler(
  options: BrainSchedulerOptions
): BrainScheduler {
  const clock = options.clock ?? REAL_CLOCK;
  const requestTimeoutMs = options.requestTimeoutMs ?? 12_000;
  const fallbackMs = options.fallbackMs ?? 1500;
  const callTimeoutMs = options.callTimeoutMs ?? 60_000;
  const maxTokens = options.maxTokens ?? 400;
  const ceilingUsd = options.ceilingUsd ?? Number.POSITIVE_INFINITY;
  const metrics =
    options.metrics ??
    createModelMetrics({
      now: clock.now,
      price: (model) => modelEntry(model).price,
    });

  const participants = new Map<string, RoomParticipant>();
  /** Participants with a call of ours in flight. */
  const busy = new Set<string>();
  /** Participants the hub may still hold busy (a 409, an abandoned call). */
  const leftBehind = new Set<string>();
  const disabled = new Set<string>();
  const queue: Queued[] = [];
  const settled: BrainResult[] = [];
  /** The order in which each participant was last asked. */
  const lastAsked = new Map<string, number>();
  let asked = 0;
  let wakeAt: number | undefined;
  let wakeTimer: unknown;

  function exceeded() {
    return metrics.spendingUsd() >= ceilingUsd;
  }

  function finish(queued: Queued, result: BrainResult) {
    if (queued.finished) {
      return;
    }
    queued.finished = true;
    clock.clearTimeout(queued.expire);
    settled.push(result);
  }

  function fail(queued: Queued, reason: string) {
    finish(queued, { requestId: queued.request.id, ok: false, reason });
  }

  function failEveryoneQueued(reason: string) {
    for (const queued of queue.splice(0, queue.length)) {
      fail(queued, reason);
    }
  }

  function free(participant: RoomParticipant) {
    return !(
      busy.has(participant.id) ||
      leftBehind.has(participant.id) ||
      disabled.has(participant.model)
    );
  }

  function leastRecentlyAsked(candidates: RoomParticipant[]) {
    return candidates.sort(
      (a, b) => (lastAsked.get(a.id) ?? 0) - (lastAsked.get(b.id) ?? 0)
    )[0];
  }

  /** Runs `dispatch` again when the oldest wait for an own model runs out. */
  function wakeFor(at: number) {
    if (wakeAt !== undefined && wakeAt <= at) {
      return;
    }
    clock.clearTimeout(wakeTimer);
    wakeAt = at;
    wakeTimer = clock.setTimeout(
      () => {
        wakeAt = undefined;
        dispatch();
      },
      Math.max(0, at - clock.now())
    );
  }

  function choose(queued: Queued): RoomParticipant | undefined {
    const available = [...participants.values()].filter(free);
    const own = queued.request.model;
    const ownIsUp =
      own &&
      !disabled.has(own) &&
      [...participants.values()].some(
        (participant) => participant.model === own
      );
    if (ownIsUp) {
      const mine = available.filter((participant) => participant.model === own);
      if (mine.length > 0) {
        return leastRecentlyAsked(mine);
      }
      const waitUntil = queued.enqueuedAt + fallbackMs;
      if (clock.now() < waitUntil) {
        wakeFor(waitUntil);
        return;
      }
    }
    return leastRecentlyAsked(available);
  }

  function dispatch() {
    if (exceeded()) {
      failEveryoneQueued("the session's spending ceiling was reached");
      return;
    }
    for (let index = 0; index < queue.length; ) {
      const queued = queue[index] as Queued;
      const participant = choose(queued);
      if (!participant) {
        index += 1;
        continue;
      }
      queue.splice(index, 1);
      run(participant, queued);
    }
  }

  async function call(participant: RoomParticipant, body: ChatCompletionBody) {
    const attempt = metrics.begin(participant.id, participant.model);
    const startedAt = clock.now();
    const abort = new AbortController();
    const timer = clock.setTimeout(
      () => abort.abort(new Error("the hub took too long")),
      callTimeoutMs
    );
    try {
      const completion = await options.infer(
        participant.id,
        body,
        abort.signal
      );
      const checked = toolArguments(completion, body.tools[0] as FunctionTool);
      const action = checked.ok ? parseDecision(completion) : undefined;
      metrics.end(attempt, {
        dispatched: true,
        status: 200,
        valid: action !== undefined,
        durationMs: clock.now() - startedAt,
        usage: usageOf(completion),
      });
      return action
        ? ({ kind: "decided", action } as const)
        : ({
            kind: "unusable",
            reason: checked.ok ? "the action does not fit" : checked.reason,
          } as const);
    } catch (error) {
      const refused = refusedByHub(error);
      const status = (error as { status?: unknown } | null)?.status;
      metrics.end(attempt, {
        dispatched: refused === undefined,
        status: typeof status === "number" ? status : 0,
        valid: false,
        durationMs: clock.now() - startedAt,
      });
      if (abort.signal.aborted) {
        // The hub still holds the participant until its upstream answers.
        leftBehind.add(participant.id);
      }
      const reason = error instanceof Error ? error.message : String(error);
      return refused === undefined
        ? ({ kind: "failed", reason } as const)
        : ({ kind: "refused", status: refused, reason } as const);
    } finally {
      clock.clearTimeout(timer);
    }
  }

  async function decide(participant: RoomParticipant, queued: Queued) {
    const tool = decisionTool(queued.request);
    const body: ChatCompletionBody = {
      model: participant.id,
      stream: false,
      max_tokens: maxTokens,
      messages: decisionMessages(queued.request),
      tools: [tool],
      tool_choice: "required",
    };
    let reason = "no answer";
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the repeat only happens after the first answer came back unusable.
      const outcome = await call(participant, body);
      if (outcome.kind === "decided") {
        finish(queued, {
          requestId: queued.request.id,
          ok: true,
          action: outcome.action,
          model: participant.model,
        });
        return;
      }
      if (outcome.kind === "refused") {
        // Not the model's fault and not an attempt: another participant takes it.
        if (outcome.status === 409) {
          leftBehind.add(participant.id);
        } else {
          participants.delete(participant.id);
        }
        if (!queued.finished) {
          queue.unshift(queued);
        }
        return;
      }
      reason = outcome.reason;
      if (queued.finished || exceeded()) {
        return;
      }
    }
    fail(queued, reason);
  }

  function run(participant: RoomParticipant, queued: Queued) {
    busy.add(participant.id);
    asked += 1;
    lastAsked.set(participant.id, asked);
    decide(participant, queued)
      .catch((error) =>
        fail(queued, error instanceof Error ? error.message : String(error))
      )
      .finally(() => {
        busy.delete(participant.id);
        dispatch();
      });
  }

  return {
    metrics,
    budget: () => ({
      spentUsd: metrics.spendingUsd(),
      ceilingUsd,
      exceeded: exceeded(),
    }),
    resetBudget() {
      metrics.reset();
      dispatch();
    },
    drain() {
      return settled.splice(0, settled.length);
    },
    models() {
      const byModel = new Map<string, AvailableModel>();
      for (const participant of participants.values()) {
        const entry = byModel.get(participant.model) ?? {
          model: participant.model,
          participants: 0,
          enabled: !disabled.has(participant.model),
        };
        entry.participants += 1;
        byModel.set(participant.model, entry);
      }
      return [...byModel.values()].sort((a, b) =>
        a.model.localeCompare(b.model)
      );
    },
    setModelEnabled(model, enabled) {
      if (enabled) {
        disabled.delete(model);
      } else {
        disabled.add(model);
      }
      dispatch();
    },
    setParticipants(next) {
      participants.clear();
      for (const participant of next) {
        participants.set(participant.id, participant);
        if (participant.busy === false) {
          leftBehind.delete(participant.id);
        }
      }
      dispatch();
    },
    submit(request) {
      const queued: Queued = {
        request,
        enqueuedAt: clock.now(),
        finished: false,
        expire: undefined,
      };
      if (exceeded()) {
        fail(queued, "the session's spending ceiling was reached");
        return;
      }
      queued.expire = clock.setTimeout(() => {
        const index = queue.indexOf(queued);
        if (index >= 0) {
          queue.splice(index, 1);
        }
        fail(queued, `no answer within ${requestTimeoutMs}ms`);
      }, requestTimeoutMs);
      queue.push(queued);
      dispatch();
    },
  };
}
