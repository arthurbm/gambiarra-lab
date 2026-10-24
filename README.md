# gambiarra-lab

Experiências do [Gambiarra Club](https://gambiarra.club) construídas sobre o [Gambi](https://github.com/arthurbm/gambi): salas onde pessoas, os modelos delas e os harnesses delas (OpenCode, Claude Code, Codex) trabalham juntos.

> **Status:** em migração. O código saiu do gambi antes de a camada de harness ser publicada, então até o `gambi@0.7.0` sair o lab roda contra um checkout local do gambi. Veja [Rodando](#rodando).

## Gambi embaixo, experiências em cima

O Gambi é a infraestrutura. Cada pessoa abre um túnel até o hub e compartilha o que já tem na própria máquina: um endpoint de modelo ou um harness, com o login que já usa. O hub só repassa mensagens; ele nunca abre conexão com ninguém, e as credenciais não saem do PC de cada pessoa.

Este repositório guarda o que roda por cima disso: quem fala com quem, em que ordem, quem decide e o que aparece no telão.

```text
gambiarra-lab                  dinâmicas, orquestração, telas
  apps/board · packages/agents
        │  gambi-sdk   client.harness.attach(), createHarnessParticipantSession()
        │  gambi CLI   gambi participant join --harness …
        ▼
gambi                          hub, túnel, relay ACP, workspaces
        │  túnel aberto pelo participante
        ▼
PC de cada pessoa              modelo local ou harness já logado
```

A dependência só vai de cima para baixo: o gambi nunca importa nada daqui.

## Experiências

| Experiência | Estado | Onde |
|---|---|---|
| **Cidade das inteligências mistas**, preparada para o encontro de 2026-08-23. Squads constroem uma cidade bairro por bairro. Cada squad registra uma decisão antes de despachar trabalho para o próprio harness, e um steerer humano, que muda a cada rodada, aceita o resultado ou o devolve com um motivo. | O encontro aconteceu sem o board. O código está aqui e precisa voltar a rodar. | `apps/board`, `apps/board-web`, `docs/gambiarra-2026-08-23/` |
| **Arena** reconstruída sobre o Gambi, usando o [Gambiarra Arena](https://github.com/filipecalegario/gambiarra-arena) como referência de regras e jogos. | Próxima. | `apps/arena` (a criar) |

## Pacotes

| Pacote | O que é |
|---|---|
| `@gambiarra-lab/agents` | Orquestrador hub-and-spoke com steerer humano: squads, desafios, drafts, decisão antes do dispatch e devoluções. Não sabe nada de rodadas, tiles ou da cidade. Ver [`packages/agents/README.md`](packages/agents/README.md). |
| `@gambiarra-lab/board`, `@gambiarra-lab/board-web` | Servidor do board (SQLite, oRPC, SSE) e a interface. |
| `@gambiarra-lab/ui` | Componentes shadcn compartilhados entre as experiências. |

Nenhum pacote vai para o npm enquanto tiver um consumidor só.

## Rodando

Precisa de [Bun](https://bun.sh) e do gambi clonado ao lado deste repositório, em `../gambi`, na branch do [PR #81](https://github.com/arthurbm/gambi/pull/81) até ela ser mergeada. Para usar outro caminho, defina `GAMBI_DIR`.

```bash
(cd ../gambi && bun install)
bun install
bun run link:gambi   # builda o gambi-sdk local e aponta o SDK e o CLI `gambi` para ele
bun run check-types
bun test apps/board/src
```

O `bun install` desfaz os links. Depois de cada install, rode `bun run link:gambi` de novo.

`bun run board:e2e` roda o evento completo com harnesses falsos e banco efêmero, sem chamar modelo. Ele volta a funcionar depois do item 2 de [`docs/next-steps.md`](docs/next-steps.md), que lista em ordem o que falta. `bun run event` é a versão com OpenCode de verdade.

Antes de commitar, rode `bun x ultracite fix`.

## Leitura

- [`docs/gambiarra-2026-08-23/`](docs/gambiarra-2026-08-23/): notas para os slides, roteiro do dia, o que ficou para depois e evidências.
- [`docs/tres-inteligencias-revisitadas-notas.md`](docs/tres-inteligencias-revisitadas-notas.md): notas sobre *As Três Inteligências Revisitadas* (Meira et al.). O livro é inspiração, não especificação.
- [`CONTEXT.md`](CONTEXT.md): glossário daqui (orchestrator, steerer, squad, decision e outros). O vocabulário de hub, túnel, harness e workspace fica no [glossário do gambi](https://github.com/arthurbm/gambi/blob/main/CONTEXT.md).
- Por que este repositório existe: revisão de 2026-10-24 da [ADR-0006 do gambi](https://github.com/arthurbm/gambi/blob/main/docs/adr/0006-harness-participants-over-acp.md).

## Contribuindo

As regras estão em [`AGENTS.md`](AGENTS.md):

- a dependência só vai de cima para baixo;
- nada é publicado com um consumidor só;
- uma primitiva só entra em `packages/agents` quando duas experiências precisam dela;
- commits seguem Conventional Commits.

Como o Gambi, tudo aqui é para rede local confiável e não tem autenticação nativa.
