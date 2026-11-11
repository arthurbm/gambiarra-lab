# AGENTS.md

> `CLAUDE.md` at the repo root is a symlink to this file. Edit `AGENTS.md` only.

Gambiarra Lab is where the Gambiarra Club builds social experiences on top of [Gambi](https://github.com/arthurbm/gambi): rooms where people, their models and their harnesses work together. Gambi is the substrate (hub, tunnel, harness participants). This repo holds what runs on top of it: the 2026-08-23 city board, the Bloco de frevo, the orchestration library, and the next experiences.

## Rules

1. **Gambi never imports from this repo.** Dependencies point one way: the lab consumes the published `gambi` CLI and `gambi-sdk`. If something here is needed by Gambi itself, it moves to Gambi through a design decision there, not by import.
2. **Nothing here is published to npm while it has a single consumer.** Every workspace package stays `private: true`.
3. **A term or primitive enters `packages/agents` only when two experiences need it.** Until then it lives in the app that uses it. "Gambi Agents", if it ever exists, is extracted from what two experiences share. Meira et al. (*As Três Inteligências Revisitadas*) are an inspiration, not the specification.
4. **`packages/agents` knows nothing about rounds, tiles or the city.** No import from `apps/*` and no event-specific vocabulary in its prompts. Keep this checkable by absence of imports.
5. **Conventional Commits** on every commit (`type(scope): subject`, e.g. `feat(board): add round timer`). PRs are squash-merged, so the PR title becomes the commit and follows the same form; CI checks the title and every non-merge commit.
6. **Trusted local network only.** Gambi has no native auth; neither do these experiences. One exception: the Bloco de frevo (`apps/frevo`) runs in public on Railway with only the world server public, the hub and model host on the private network, and the OpenRouter key only in the model host; what each service holds is in `apps/frevo/README.md` ("Deploy").

## Commands

The scripts are in `package.json`; what their names do not say:

```bash
bun run frevo:dev -- --real   # OpenRouter models instead of fake ones (spends money)
bun run frevo:stop            # stops this worktree's frevo:dev by its pidfile; never pkill by name
bun run board:e2e             # fake harnesses, ephemeral DB; runs until SIGINT
bun run board:smoke           # boots hub, fixtures, board and web on free ports; exits 0/1
bun run frevo:smoke           # same for the frevo with a fake model; also kills the model host and restarts the hub
bun run frevo:spend           # the account's real OpenRouter balance; a key's limit is not the balance
bun x ultracite fix           # Ultracite (Biome preset): format before committing
```

`test`, both smokes and `frevo:load` take one lock per machine (`scripts/heavy.ts`), shared by every worktree, and wait their turn; see `docs/bloco-de-frevo/onde-esta-cada-coisa.md` for what stays outside it.

## Where to look

| Topic | Path |
|---|---|
| Glossary (orchestration, experience, starter) | `CONTEXT.md` |
| Harness, Workspace, tunnel, hub vocabulary | [gambi `CONTEXT.md`](https://github.com/arthurbm/gambi/blob/main/CONTEXT.md) |
| Why this repo exists (decision record) | [gambi ADR-0006, revisão 2026-10-24](https://github.com/arthurbm/gambi/blob/main/docs/adr/0006-harness-participants-over-acp.md) |
| What is left after the split | `docs/next-steps.md` |
| The 2026-08-23 event (notes, runbook, later, evidence) | `docs/gambiarra-2026-08-23/` |
| Conceptual notes on the book | `docs/tres-inteligencias-revisitadas-notas.md` |
| Orchestration library | `packages/agents/README.md` |
| Board | `apps/board/README.md`, `apps/board-web/DESIGN.md` |
| Bloco de frevo (world, model host, telão) | `apps/frevo/README.md`, spec in issue #10 |
| Bloco de frevo deploy (Railway, docker compose) | `apps/frevo/README.md` ("Deploy"), `.railway/railway.ts`, `deploy/frevo/`, `compose.yaml` |
| Bloco de frevo: public URLs, deploys, where videos and secrets live, running heavy jobs | `docs/bloco-de-frevo/onde-esta-cada-coisa.md` |
| Bloco de frevo: what the host does on the admin, phase by phase, and when something goes wrong | `docs/bloco-de-frevo/guia-do-admin.md` |
| Bloco de frevo: exploration notes from 2026-11-11 (gambi-sdk, OpenRouter models, Railway, music, pixel art); may be stale | `docs/bloco-de-frevo/notas/` |

Anything a later session needs to remember goes in this repo, under `docs/`, with a row in the table above. Keep it out of a harness's private memory.
