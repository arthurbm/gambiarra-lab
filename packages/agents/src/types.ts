import type { HarnessEvent } from "./transport.ts";

export interface Squad {
  harnessParticipantId?: string;
  id: string;
  memberNames: string[];
  name: string;
}

export interface Round {
  id: string;
  name: string;
  objective: string;
}

export interface Challenge {
  id: string;
  objective: string;
  roundId: string;
  seededDraftIds: string[];
  squadId: string;
  status: "draft" | "dispatched";
}

export type DraftOrigin = "human" | "harness";

export interface Draft {
  authorName: string;
  challengeId: string;
  content: string;
  id: string;
  origin: DraftOrigin;
}

export interface Decision {
  build: string;
  challengeId: string;
  consideredDraftIds: string[];
  cut: string;
  id: string;
  reason: string;
  roundId: string;
  squadId: string;
  steererName: string;
}

export interface DispatchPayload {
  constraints: string[];
  decision: Decision;
  expectedOutput: string;
  input: string;
  objective: string;
}

export interface Dispatch {
  challengeId: string;
  id: string;
  payload: DispatchPayload;
  roundId: string;
  sessionId: string;
  squadId: string;
}

export interface Review {
  dispatchId: string;
  id: string;
  outcome: "accepted" | "returned";
  reason?: string;
  reviewerName: string;
  roundId: string;
  squadId: string;
}

export interface Escalation {
  id: string;
  question: string;
  reason: string;
  response?: string;
  returnCount: number;
  roundId: string;
  squadId: string;
  status: "pending" | "answered";
}

export type DomainEvent =
  | {
      sequence: number;
      type: "challenge.created";
      challenge: Challenge;
    }
  | { sequence: number; type: "draft.added"; draft: Draft }
  | {
      sequence: number;
      type: "decision.recorded";
      decision: Decision;
    }
  | {
      sequence: number;
      type: "dispatch.sent";
      dispatch: Dispatch;
    }
  | { sequence: number; type: "review.recorded"; review: Review }
  | {
      sequence: number;
      type: "escalation.raised";
      escalation: Escalation;
    }
  | {
      sequence: number;
      type: "escalation.answered";
      escalation: Escalation;
    }
  | {
      sequence: number;
      type: "model.swapped";
      previousModel: string;
      nextModel: string;
      handoff: string;
    }
  | {
      sequence: number;
      type: "harness.event";
      squadId: string;
      event: HarnessEvent;
    };

export interface WorldState {
  challenges: Challenge[];
  decisions: Decision[];
  dispatches: Dispatch[];
  drafts: Draft[];
  escalations: Escalation[];
  reviews: Review[];
  rounds: Round[];
  squads: Squad[];
}

export interface SeededDraftInput {
  authorName?: string;
  content: string;
  origin?: DraftOrigin;
}

export interface CreateChallengeInput {
  id?: string;
  objective: string;
  roundId: string;
  seededDrafts: SeededDraftInput[];
  squadId: string;
}

export interface RecordDecisionInput {
  build: string;
  challengeId: string;
  consideredDraftIds: string[];
  cut: string;
  id?: string;
  reason: string;
  steererName: string;
}

export interface SendDispatchInput {
  challengeId: string;
  constraints?: string[];
  expectedOutput: string;
  id?: string;
  input: string;
}

export interface RecordReviewInput {
  dispatchId: string;
  id?: string;
  outcome: Review["outcome"];
  reason?: string;
  reviewerName: string;
}
