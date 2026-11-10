# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. Desde o `gambi@0.7.0` o lab usa o CLI e o `gambi-sdk` publicados: os harnesses `fake` rodam `scripts/fake-acp-agent.ts` pelo `createFakeHarnessAdapter()`, os harnesses hospedados do board recebem o starter da cidade por `createCityTileWorkspace()` (`apps/board/src/starter/city-tile.ts`), um `Workspace` que compõe `createLocalDirectoryWorkspace()`, e quem traz o próprio harness recebe o starter no texto do primeiro prompt de cada sessão (`withCityTileStarter()` em `apps/board/src/harness-runtime.ts`). O orquestrador usa o AI SDK v7 com `@ai-sdk/openai-compatible` apontado para o endpoint da sala (`apps/board/src/room-models.ts`). Esta é a lista do que falta, em ordem.

## 1. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.

## 2. Dívida de lint do Ultracite 8

O scaffold trouxe o Ultracite 8, mais rígido que o 7 que o gambi usava quando o board foi escrito. O `bun x ultracite fix` já aplicou as correções seguras. Restam cerca de 150 erros de regras novas, principalmente `noJsxPropsBind`, `noAwaitInLoops`, `noDescendingSpecificity`, `noUnnecessaryConditions` e `useDestructuring`. Corrija junto com cada mudança no arquivo afetado, ou desligue uma regra no `biome.jsonc` com o motivo anotado.
