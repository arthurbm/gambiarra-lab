# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. Hoje o lab depende do `gambi-sdk@0.6.0`, que ainda não tem a API de harness. Por isso parte do código não compila. Esta é a lista do que falta, em ordem.

## 1. Trabalhar contra o gambi local até o 0.7.0

Até o `gambi@0.7.0` e o `gambi-sdk@0.7.0` saírem, use os pacotes locais:

```bash
cd ../gambi/packages/sdk && bun link
cd ../gambi/packages/cli && bun link
cd ../gambiarra-lab && bun link gambi-sdk && bun link gambi
```

Depois do release, troque `^0.6.0` por `^0.7.0` no `package.json` raiz, em `apps/board` e em `packages/agents`, e remova os links.

## 2. Harness hospedado e fake agent via `gambi-sdk`

Os imports já apontam para `gambi-sdk`: `createHarnessParticipantSession`, `HarnessParticipantSession` e `HarnessParticipantSessionOptions`. Eles só existem a partir do 0.7.0. Quando o SDK exportar o fake ACP agent como função executável, crie `scripts/fake-acp-agent.ts`, que só importa e executa a função, e aponte o harness hospedado `fake` do board para ele. Hoje o board passa o id `fake` e depende do adapter do core, que acha o script pelo caminho do arquivo-fonte. Esse caminho não existe dentro do pacote publicado.

Arquivos afetados: `apps/board/src/harness-runtime.ts`, `apps/board/src/__tests__/harness-runtime.test.ts`, `packages/agents/src/tunnel-transport.integration.test.ts` e `packages/agents/scripts/demo.ts`.

## 3. `StarterWorkspace` com o starter da cidade

O gambi deixou de semear o starter da cidade. O workspace padrão do core agora tem só `.gambi.json`. O starter mora em `apps/board/src/starter/city-tile.ts` (`seedCityTileStarter`). Falta:

- Um `StarterWorkspace` que implemente a costura `Workspace` do `gambi-sdk` e chame `seedCityTileStarter` no `prepare()`, para os harnesses hospedados.
- Para quem traz o próprio harness: mandar o starter no texto do primeiro dispatch, ou orientar a pessoa a baixá-lo e rodar `gambi participant join --harness <id> --workspace ./pasta`. O túnel não tem canal para gravar arquivos no PC de ninguém, e isso é deliberado.

## 4. AI SDK v7

O lab pode ir para `ai@7` antes do gambi. O `createGambi()` do `gambi-sdk` devolve `LanguageModelV3` (provider spec 3) e não serve para o v7. Para o modelo do orquestrador, use `@ai-sdk/openai-compatible@3` apontado direto para o endpoint OpenAI-compatible da sala (`<hub>/rooms/<code>/v1`). O `gambi-sdk` continua sendo usado só para `harness.attach` e `createHarnessParticipantSession`, que não dependem do `ai`. Use a skill `migrate-ai-sdk-v6-to-v7`.

## 5. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.
