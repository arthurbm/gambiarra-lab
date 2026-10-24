# Gambiarra Lab

Experiences that the Gambiarra Club builds on top of [Gambi](https://github.com/arthurbm/gambi). This glossary covers orchestration and event vocabulary only. Harness, Harness participant, Harness session and Workspace are defined in [gambi's `CONTEXT.md`](https://github.com/arthurbm/gambi/blob/main/CONTEXT.md) and mean the same thing here.

## Language

### Orchestration

**Orchestrator**:
A harness whose tools are other harness participants: it decomposes an objective, dispatches work to squads, and integrates what comes back. It always has one human steering it. Orchestration lives above the hub, never inside it.
_Avoid_: Coordinator, manager, supervisor, mayor.

**Steerer**:
The one human currently responsible for a harness: the only person who writes to it, and the one who accepts or returns its output with a reason. The role rotates; it is not tied to a machine.
_Avoid_: Operator, supervisor, owner, driver.

**Squad**:
A group of people, each possibly with their own harness participant, with one steerer at a time. Per round the squad designates which harness participant receives dispatches (normally the steerer's). The unit of social participation in a shared experience.
_Avoid_: Team, group, crew.

**Dispatch** (harness dispatch):
The orchestrator handing a typed task (objective, input, expected output, constraints) to one harness participant's session. Distinct from inference-plane **routing** of a single model request.
_Avoid_: Assign, delegate (fine in prose, not as the term).

**Draft**:
A proposal a squad member offers to the current steerer, written by hand or produced by the member's own harness; the orchestrator also seeds two or three per challenge. Only the steerer can turn a draft into input for the dispatched harness.
_Avoid_: Suggestion, comment, vote.

**Decision**:
The squad's recorded answer to a challenge before any dispatch: what it builds, what it cuts, why, which drafts it considered, and who steered. Decisions are first-class and visible; they are the evidence that humans deliberated.
_Avoid_: Plan, choice, vote.

**Challenge**:
What the orchestrator hands a squad per round, together with seeded drafts. A squad answers a challenge with a decision, then dispatches.
_Avoid_: Task (reserve for the typed dispatch payload), mission.

**Return** (returned output):
The steerer sending a harness's output back with a reason instead of accepting it. Returns are logged; their count per squad is the first divergence signal.
_Avoid_: Reject, veto, fail.

### Experiences

**Starter**:
The initial content an experience places in a participant's Workspace before the first dispatch, such as the city tile's `index.html`, `README.md` and `manifest.json`. It belongs to the experience, never to Gambi.
_Avoid_: Template, seed (fine in prose), boilerplate.

**Experience**:
One social dynamic built on Gambi, with its own app, rules and data (the 2026-08-23 city board is the first). Primitives move from an experience into `packages/agents` only when a second experience needs them.
_Avoid_: Demo, project, game (unless the experience is literally a game).

## Relationships

- A **Squad** is people, zero-to-many **Harness participants** (one designated per round for dispatch), exactly one **Steerer** at a time, and any number of **Drafts**.
- Per round: a **Challenge** gathers **Drafts**, the steerer records a **Decision**, then the orchestrator **dispatches**; output is accepted or **returned**.
- An **Orchestrator** is a harness; it **dispatches** to harness participants and receives accepted or **returned** output.
- An **Experience** supplies the **Starter** for the Workspaces it dispatches to.

## Flagged ambiguities

- **"Steerer"** is a role, not a person or a machine. "The steerer of squad B" changes every round. Never say "the steerer's laptop"; say "the squad's harness participant".

- **"Orchestrator"** names the harness, not the human steering it. Say "the orchestrator's steerer" for the person.
- **"Agents"** in `@gambiarra-lab/agents` names this repo's orchestration library, not the future "Gambi Agents" product. Meira et al. are an inspiration for it, not its specification.
