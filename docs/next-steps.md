# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. Desde o `gambi@0.7.0` o lab usa o CLI e o `gambi-sdk` publicados: os harnesses `fake` rodam `scripts/fake-acp-agent.ts` pelo `createFakeHarnessAdapter()`, e os harnesses hospedados do board recebem o starter da cidade por `createCityTileWorkspace()` (`apps/board/src/starter/city-tile.ts`), um `Workspace` que compõe `createLocalDirectoryWorkspace()`. Esta é a lista do que falta, em ordem.

## 1. Tipos do `gambi-sdk` publicado

As `.d.ts` do `gambi-sdk` (0.6.0 e 0.7.0) importam `@gambi/core/...`, que não é publicado. Fora do monorepo do gambi, todo tipo do SDK vira `any` em silêncio: o `check-types` do lab não pega uso errado da API, e `interface X extends HarnessParticipantSession` perde os campos. A correção é no gambi: empacotar as declarações do core junto com o SDK. Até lá, anote os tipos do SDK explicitamente (parâmetros de `Workspace.prepare()`, por exemplo) e não estenda interfaces do SDK. Para conferir o lab contra os tipos reais, aponte `node_modules/@gambi/core` para `packages/core` de um checkout do gambi na mesma versão, rode `bun run check-types` e apague o link.

## 2. Starter para quem traz o próprio harness

Os harnesses hospedados já recebem o starter. Para quem roda `gambi participant join --harness <id>` na própria máquina, falta mandar o starter no texto do primeiro dispatch, ou orientar a pessoa a baixá-lo e rodar `gambi participant join --harness <id> --workspace ./pasta`. O túnel não tem canal para gravar arquivos no PC de ninguém, e isso é deliberado.

## 3. AI SDK v7

O lab pode ir para `ai@7` antes do gambi. O `createGambi()` do `gambi-sdk` devolve `LanguageModelV3` (provider spec 3) e não serve para o v7. Para o modelo do orquestrador, use `@ai-sdk/openai-compatible@3` apontado direto para o endpoint OpenAI-compatible da sala (`<hub>/rooms/<code>/v1`). O `gambi-sdk` continua sendo usado só para `harness.attach` e `createHarnessParticipantSession`, que não dependem do `ai`. Use a skill `migrate-ai-sdk-v6-to-v7`.

## 4. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.

## 5. Dívida de lint do Ultracite 8

O scaffold trouxe o Ultracite 8, mais rígido que o 7 que o gambi usava quando o board foi escrito. O `bun x ultracite fix` já aplicou as correções seguras. Restam cerca de 150 erros de regras novas, principalmente `noJsxPropsBind`, `noAwaitInLoops`, `noDescendingSpecificity`, `noUnnecessaryConditions` e `useDestructuring`. Corrija junto com cada mudança no arquivo afetado, ou desligue uma regra no `biome.jsonc` com o motivo anotado.
