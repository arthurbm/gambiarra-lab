# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. Desde o `gambi@0.7.0` o lab usa o CLI e o `gambi-sdk` publicados: os harnesses `fake` rodam `scripts/fake-acp-agent.ts` pelo `createFakeHarnessAdapter()`, e os harnesses hospedados do board recebem o starter da cidade por `createCityTileWorkspace()` (`apps/board/src/starter/city-tile.ts`), um `Workspace` que compõe `createLocalDirectoryWorkspace()`. Esta é a lista do que falta, em ordem.

## 1. Starter para quem traz o próprio harness

Os harnesses hospedados já recebem o starter. Para quem roda `gambi participant join --harness <id>` na própria máquina, falta mandar o starter no texto do primeiro dispatch, ou orientar a pessoa a baixá-lo e rodar `gambi participant join --harness <id> --workspace ./pasta`. O túnel não tem canal para gravar arquivos no PC de ninguém, e isso é deliberado.

## 2. AI SDK v7

O lab pode ir para `ai@7` antes do gambi. O `createGambi()` do `gambi-sdk` devolve `LanguageModelV3` (provider spec 3) e não serve para o v7. Para o modelo do orquestrador, use `@ai-sdk/openai-compatible@3` apontado direto para o endpoint OpenAI-compatible da sala (`<hub>/rooms/<code>/v1`). O `gambi-sdk` continua sendo usado só para `harness.attach` e `createHarnessParticipantSession`, que não dependem do `ai`. Use a skill `migrate-ai-sdk-v6-to-v7`.

## 3. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.

## 4. Dívida de lint do Ultracite 8

O scaffold trouxe o Ultracite 8, mais rígido que o 7 que o gambi usava quando o board foi escrito. O `bun x ultracite fix` já aplicou as correções seguras. Restam cerca de 150 erros de regras novas, principalmente `noJsxPropsBind`, `noAwaitInLoops`, `noDescendingSpecificity`, `noUnnecessaryConditions` e `useDestructuring`. Corrija junto com cada mudança no arquivo afetado, ou desligue uma regra no `biome.jsonc` com o motivo anotado.
