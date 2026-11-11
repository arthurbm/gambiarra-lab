// The brain scheduler. It takes the decisions the simulation asked for, picks
// a free model participant of the Room, calls the inference plane and hands
// the action back. The hub serves one request at a time per participant and
// never says who answered, so the choice of participant is made here.
import type { BrainResult, DecisionRequest } from "../sim/world";
import {
  type ChatMessage,
  decisionMessages,
  decisionTool,
  type FunctionTool,
  parseDecision,
} from "./decision";

export interface RoomParticipant {
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
  tool_choice: { function: { name: string }; type: "function" };
  tools: FunctionTool[];
}

/** One non-streaming chat/completions call to a participant; resolves with the JSON body. */
export type Inference = (
  participantId: string,
  body: ChatCompletionBody,
  signal: AbortSignal
) => Promise<unknown>;

export interface BrainScheduler {
  /** Results that settled since the last call. */
  drain: () => BrainResult[];
  /** The model participants that can answer right now. */
  setParticipants: (participants: RoomParticipant[]) => void;
  submit: (request: DecisionRequest) => void;
}

export interface BrainSchedulerOptions {
  infer: Inference;
  maxTokens?: number;
  /** How long a request may wait and run before it is reported as failed. */
  requestTimeoutMs?: number;
}

/** Attempts per request: the first, and one repeat when no tool call comes back. */
const ATTEMPTS = 2;

interface Queued {
  expire: ReturnType<typeof setTimeout>;
  request: DecisionRequest;
  signal: AbortController;
}

export function createBrainScheduler(
  options: BrainSchedulerOptions
): BrainScheduler {
  const requestTimeoutMs = options.requestTimeoutMs ?? 12_000;
  const maxTokens = options.maxTokens ?? 400;
  const participants = new Map<string, RoomParticipant>();
  const busy = new Set<string>();
  const queue: Queued[] = [];
  const settled: BrainResult[] = [];
  /** The order in which each participant was last asked. */
  const lastAsked = new Map<string, number>();
  let asked = 0;

  function fail(requestId: string, reason: string) {
    settled.push({ requestId, ok: false, reason });
  }

  async function decide(participant: RoomParticipant, queued: Queued) {
    const { request, signal } = queued;
    const tool = decisionTool(request);
    const body: ChatCompletionBody = {
      model: participant.id,
      stream: false,
      max_tokens: maxTokens,
      messages: decisionMessages(request),
      tools: [tool],
      tool_choice: { type: "function", function: { name: tool.function.name } },
    };
    for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the repeat only happens after the first answer came back unusable.
      const completion = await options.infer(
        participant.id,
        body,
        signal.signal
      );
      const action = parseDecision(completion, request);
      if (action) {
        return action;
      }
    }
    throw new Error("the model answered without calling the tool");
  }

  function dispatch() {
    while (queue.length > 0) {
      // The free participant that answered longest ago, so models take turns;
      // one of the boneco's own model first, when one is free.
      const preferred = queue[0]?.request.model;
      const [free] = [...participants.values()]
        .filter((participant) => !busy.has(participant.id))
        .sort(
          (a, b) =>
            Number(b.model === preferred) - Number(a.model === preferred) ||
            (lastAsked.get(a.id) ?? 0) - (lastAsked.get(b.id) ?? 0)
        );
      if (!free) {
        return;
      }
      const queued = queue.shift() as Queued;
      busy.add(free.id);
      asked += 1;
      lastAsked.set(free.id, asked);
      decide(free, queued)
        .then((action) => {
          if (!queued.signal.signal.aborted) {
            settled.push({
              requestId: queued.request.id,
              ok: true,
              action,
              model: free.model,
            });
          }
        })
        .catch((error) => {
          if (!queued.signal.signal.aborted) {
            fail(
              queued.request.id,
              error instanceof Error ? error.message : String(error)
            );
          }
        })
        .finally(() => {
          clearTimeout(queued.expire);
          busy.delete(free.id);
          dispatch();
        });
    }
  }

  return {
    drain() {
      return settled.splice(0, settled.length);
    },
    setParticipants(next) {
      participants.clear();
      for (const participant of next) {
        participants.set(participant.id, participant);
      }
      dispatch();
    },
    submit(request) {
      const signal = new AbortController();
      const queued: Queued = {
        request,
        signal,
        expire: setTimeout(() => {
          const index = queue.indexOf(queued);
          if (index >= 0) {
            queue.splice(index, 1);
          }
          fail(request.id, `no answer within ${requestTimeoutMs}ms`);
          signal.abort(new Error("the decision request timed out"));
        }, requestTimeoutMs),
      };
      queue.push(queued);
      dispatch();
    },
  };
}
