# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. O `gambi-sdk@0.6.0` publicado ainda não tem a API de harness. Por isso o lab roda contra o gambi local (item 1). Esta é a lista do que falta, em ordem.

## 1. Trabalhar contra o gambi local até o 0.7.0

Até o `gambi@0.7.0` e o `gambi-sdk@0.7.0` saírem, rode `bun run link:gambi` depois de cada `bun install`. O script (`scripts/link-local-gambi.ts`) builda o `gambi-sdk` do checkout em `../gambi` (ou `GAMBI_DIR`), aponta o `node_modules/gambi-sdk` da raiz, de `apps/board` e de `packages/agents` para ele, e troca `node_modules/.bin/gambi` por um shim que roda o CLI a partir do fonte. Com isso, `check-types` passa no lab inteiro e os testes do board passam.

Depois do release, troque `^0.6.0` por `^0.7.0` no `package.json` raiz, em `apps/board` e em `packages/agents`, e apague o script e o `link:gambi`.

## 2. Fake ACP agent pelo `gambi-sdk`

O `gambi-sdk` exporta `runFakeAcpAgent()` e `createFakeHarnessAdapter()`. Um SDK empacotado não consegue achar o próprio script, então hoje passar `harnessId: "fake"` sem adapter falha com `The deterministic fake ACP agent was not found … Pass a command that runs runFakeAcpAgent() to createFakeHarnessAdapter()`. Falta:

- criar `scripts/fake-acp-agent.ts`, que só importa e executa `runFakeAcpAgent()`;
- passar `adapter: createFakeHarnessAdapter({ command: process.execPath, args: [<caminho do script>] })` sempre que um harness `fake` for criado.

Arquivos afetados: `apps/board/src/harness-runtime.ts` (harnesses hospedados `fake`, usados pelo `board:e2e`), `packages/agents/src/tunnel-transport.integration.test.ts` (o único teste que falha hoje com o link) e `packages/agents/scripts/demo.ts`.

## 3. `StarterWorkspace` com o starter da cidade

O gambi deixou de semear o starter da cidade. O workspace padrão do core agora tem só `.gambi.json`. O starter mora em `apps/board/src/starter/city-tile.ts` (`seedCityTileStarter`). Falta:

- Um `Workspace` que componha `createLocalDirectoryWorkspace()` do `gambi-sdk` e chame `seedCityTileStarter(prepared.path, { harness: context.harness, model: context.model })` dentro do `prepare()`, passado como `workspace` para `createHarnessParticipantSession()` nos harnesses hospedados. O exemplo está na referência do SDK do gambi, em `createHarnessParticipantSession(options)`.
- Para quem traz o próprio harness: mandar o starter no texto do primeiro dispatch, ou orientar a pessoa a baixá-lo e rodar `gambi participant join --harness <id> --workspace ./pasta`. O túnel não tem canal para gravar arquivos no PC de ninguém, e isso é deliberado.

## 4. AI SDK v7

O lab pode ir para `ai@7` antes do gambi. O `createGambi()` do `gambi-sdk` devolve `LanguageModelV3` (provider spec 3) e não serve para o v7. Para o modelo do orquestrador, use `@ai-sdk/openai-compatible@3` apontado direto para o endpoint OpenAI-compatible da sala (`<hub>/rooms/<code>/v1`). O `gambi-sdk` continua sendo usado só para `harness.attach` e `createHarnessParticipantSession`, que não dependem do `ai`. Use a skill `migrate-ai-sdk-v6-to-v7`.

## 5. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.

## 6. Dívida de lint do Ultracite 8

O scaffold trouxe o Ultracite 8, mais rígido que o 7 que o gambi usava quando o board foi escrito. O `bun x ultracite fix` já aplicou as correções seguras. Restam cerca de 150 erros de regras novas, principalmente `noJsxPropsBind`, `noAwaitInLoops`, `noDescendingSpecificity`, `noUnnecessaryConditions` e `useDestructuring`. Corrija junto com cada mudança no arquivo afetado, ou desligue uma regra no `biome.jsonc` com o motivo anotado.
