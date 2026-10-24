# AGENTS.md

> `CLAUDE.md` at the repo root is a symlink to this file. Edit `AGENTS.md` only.

Gambiarra Lab is where the Gambiarra Club builds social experiences on top of [Gambi](https://github.com/arthurbm/gambi): rooms where people, their models and their harnesses work together. Gambi is the substrate (hub, tunnel, harness participants). This repo holds what runs on top of it: the 2026-08-23 city board, the orchestration library, and the next experiences.

## Rules

1. **Gambi never imports from this repo.** Dependencies point one way: the lab consumes the published `gambi` CLI and `gambi-sdk`. If something here is needed by Gambi itself, it moves to Gambi through a design decision there, not by import.
2. **Nothing here is published to npm while it has a single consumer.** Every workspace package stays `private: true`.
3. **A term or primitive enters `packages/agents` only when two experiences need it.** Until then it lives in the app that uses it. "Gambi Agents", if it ever exists, is extracted from what two experiences share. Meira et al. (*As Três Inteligências Revisitadas*) are an inspiration, not the specification.
4. **`packages/agents` knows nothing about rounds, tiles or the city.** No import from `apps/*` and no event-specific vocabulary in its prompts. Keep this checkable by absence of imports.
5. **Conventional Commits** on every commit (`type(scope): subject`, e.g. `feat(board): add round timer`).
6. **Trusted local network only.** Gambi has no native auth; neither do these experiences.

## Commands

```bash
bun install
bun run link:gambi           # until gambi 0.7.0: local gambi-sdk and CLI (rerun after every install)
bun run dev:hub              # gambi hub serve (published CLI)
bun run dev:board            # board server
bun run dev:board-web        # board web
bun run board:e2e            # full event with fake harnesses, ephemeral DB
bun run check-types
bun x ultracite fix          # format before committing
```

## Where to look

| Topic | Path |
|---|---|
| Glossary (orchestration, experience, starter) | `CONTEXT.md` |
| Harness, Workspace, tunnel, hub vocabulary | [gambi `CONTEXT.md`](https://github.com/arthurbm/gambi/blob/main/CONTEXT.md) |
| Why this repo exists (decision record) | [gambi ADR-0006, revisão 2026-10-24](https://github.com/arthurbm/gambi/blob/main/docs/adr/0006-harness-participants-over-acp.md) |
| What is left to make the board run again | `docs/next-steps.md` |
| The 2026-08-23 event (notes, runbook, later, evidence) | `docs/gambiarra-2026-08-23/` |
| Conceptual notes on the book | `docs/tres-inteligencias-revisitadas-notas.md` |
| Orchestration library | `packages/agents/README.md` |
| Board | `apps/board/README.md`, `apps/board-web/DESIGN.md` |

## Code style

Ultracite (Biome preset). Run `bun x ultracite fix` before committing.
