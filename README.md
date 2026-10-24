# gambiarra-lab

Laboratório de experiências do Gambiarra Club em cima do [Gambi](https://github.com/arthurbm/gambi).

O Gambi é a infraestrutura: um hub local-first onde cada pessoa conecta, por um túnel, os modelos e os harnesses (OpenCode, Claude Code, Codex) que já tem na própria máquina. Este repositório guarda o que roda por cima disso: dinâmicas sociais em que pessoas, modelos e harnesses trabalham juntos na mesma sala.

## O que tem aqui

| Caminho | O que é |
|---|---|
| `apps/board`, `apps/board-web` | Board do evento de 2026-08-23: squads constroem uma cidade, bairro por bairro, despachando trabalho para os próprios harnesses. |
| `packages/agents` | Orquestrador hub-and-spoke com steerer humano (`@gambiarra-lab/agents`). |
| `packages/ui` | Componentes shadcn compartilhados entre as experiências. |
| `docs/gambiarra-2026-08-23/` | Notas, roteiro, o que ficou para depois e evidências do evento. |
| `docs/tres-inteligencias-revisitadas-notas.md` | Notas sobre o livro de Meira et al., a inspiração conceitual. |

O código veio do PR [arthurbm/gambi#81](https://github.com/arthurbm/gambi/pull/81), com o histórico preservado. O que falta para o board rodar de novo está em [`docs/next-steps.md`](docs/next-steps.md).

## Rodando

```bash
bun install
bun run board:e2e   # evento completo com harnesses falsos e banco efêmero
```

Regras do repositório e comandos: [`AGENTS.md`](AGENTS.md).
