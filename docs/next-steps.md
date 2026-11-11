# Próximos passos

O board e o orquestrador saíram do gambi (PR [#81](https://github.com/arthurbm/gambi/pull/81)) antes de a camada de harness ser publicada. Desde o `gambi@0.7.0` o lab usa o CLI e o `gambi-sdk` publicados: os harnesses `fake` rodam `scripts/fake-acp-agent.ts` pelo `createFakeHarnessAdapter()`, os harnesses hospedados do board recebem o starter da cidade por `createCityTileWorkspace()` (`apps/board/src/starter/city-tile.ts`), um `Workspace` que compõe `createLocalDirectoryWorkspace()`, e quem traz o próprio harness recebe o starter no texto do primeiro prompt de cada sessão (`withCityTileStarter()` em `apps/board/src/harness-runtime.ts`). O orquestrador usa o AI SDK v7 com `@ai-sdk/open-responses` apontado para o endpoint Open Responses da sala (`apps/board/src/room-models.ts`). Esta é a lista do que falta, em ordem.

## 1. Arena reconstruída

A segunda experiência é uma arena reconstruída sobre o Gambi, usando o Gambiarra Arena só como referência de regras e jogos, sem importar o código. Ela vive em `apps/arena` (e `apps/arena-web`, se precisar de UI), reaproveita `packages/ui` e é o segundo consumidor de que `packages/agents` precisa antes de qualquer extração.

## Bloco de frevo: adiado do code-review de 2026-11-11

- `apps/frevo/src/sim/phases.ts`, `apps/frevo/src/sim/admin.ts`: `PHASE_HOOKS` e `BONECO_REMOVED_HOOKS` são registros globais mutáveis, e a ordem dos ganchos depende da ordem dos imports.
- `apps/frevo/src/brains/decision.ts`, `apps/frevo/src/sim/world.ts`, `apps/frevo/src/sim/formar.ts`, `apps/frevo/src/sim/compor.ts`: o mesmo `switch (request.kind)` repetido; um mapa por tipo de decisão tiraria a repetição.
- `apps/frevo/src/server/app.ts`, `apps/frevo/src/server/admin.ts`: a forma "abre stream, chama `watch()`, define `leave`" se repete em cada stream SSE.
- `apps/frevo/src/sim/world.ts`, `apps/frevo/src/brains/decision.ts`: os tipos de decisão misturam português e inglês (`nome`, `refrao`, `maestro` ao lado de `question`, `personality`, `encounter`).
- `apps/frevo/src/sim/world.ts` (1300 linhas) e `apps/frevo/src/server/app.ts` (700 linhas) mudam por razões demais.
- `apps/frevo/src/sim/ask.ts`: a pergunta aberta estende o contador de 12 s até 60 s enquanto a pessoa digita (`askTypingCapMs`, decisão do #13), o que diverge do spec.
- `apps/frevo/src/sim/blocklist.ts`: `filterModelText` corta as falas aos 140 caracteres (`speechMaxLength`) no meio da frase.
- `apps/frevo/src/server/app.ts`: as quatro opções de música de `startWorldServer` (`music`, `musicFiles`, `musicGenerations`, `musicTimeoutMs`) andam juntas e pediriam um objeto só.
- `apps/frevo/src/music/fal.ts`: os nomes `made`, `completed` e `run` dizem pouco do que cada passo faz.
- `apps/frevo/src/music/fal.ts`, `apps/frevo/src/music/jukebox.ts`, `apps/frevo-web/src/admin/admin-jury.tsx`: os textos de plural ("geração"/"gerações") e de "passou de N s" estão duplicados entre servidor e web.
- `apps/frevo/src/music/fal.ts`: um pedido que o fal.ai recusa (HTTP não-ok no envio) não conta como geração. Decisão mantida: nada foi feito nem cobrado; se o fal.ai um dia cobrar pedido recusado, o teto de seis passa a subestimar o gasto.

## Board: teste instável sem reprodução

`apps/board/src/__tests__/recovery.test.ts`, "recovers configuration, membership, phase, and audit events after restart", falhou uma vez em 2026-11-11 sem mudança de código; a saída daquela falha não foi guardada. Em 2026-11-11 o arquivo rodou sozinho 15 vezes em série (`bun test apps/board/src/__tests__/recovery.test.ts`) e passou nas 15. Cada um dos três testes leva cerca de 1 s (medido pelo relatório junit), e o arquivo inteiro de 3,3 s a 7,0 s conforme a carga da máquina, perto do limite padrão de 5 s por teste do `bun test`. A hipótese mais provável, não confirmada, é esse limite estourado com a máquina sobrecarregada por baterias paralelas de outros worktrees, o que a trava de `scripts/heavy.ts` agora evita. Se voltar a falhar, guarde a mensagem: um `timed out after 5000ms` confirma a hipótese (o remédio é um limite explícito no teste); uma asserção diferente (`events` com tamanho errado, `revision`) aponta para estado e pede outra investigação.

## Bloco de frevo: visto depois do merge de 2026-11-11

- `scripts/frevo-real-check.ts` tem dois erros de tipo que ninguém vê: o `check-types` não cobre `scripts/`. Corrigir os erros e pôr `scripts/` na checagem de tipos.
- A Railway não redeployou sozinha no merge do PR #23; ver `docs/bloco-de-frevo/onde-esta-cada-coisa.md`, seção "Deploys".
- `scripts/heavy.ts` e `frevo:stop` não foram testados num Mac.

## Bloco de frevo: em aberto ao fim da sessão de 2026-11-11

Ponto de partida de quem continuar: `docs/bloco-de-frevo/onde-esta-cada-coisa.md`.

**Deploy**

- No ar está o commit `68eafb2` (PR #22), a versão do palco. Os PRs #23 e #24 estão na `main` e não foram publicados; o #23 quase não toca código de produção.
- Para publicar a `main`: `railway up --service modelos --ci` e `railway up --service mundo --ci`, a partir do checkout principal. O `hub` não precisa, e redeployá-lo apaga as Rooms.
- Descobrir por que o push na `main` não redeploya (primeiro lugar a olhar: o acesso do GitHub App da Railway ao repositório, no painel). Enquanto isso não for resolvido, trate todo merge como se pudesse redeployar e não faça merge perto de uma apresentação.

**Nunca verificado**

- Som audível: toda música tocou em navegador sem saída de áudio. Ninguém ouviu a faixa gerada, as três de reserva nem o telão tocando.
- Celular de verdade escaneando o QR, e projetor de verdade (só capturas em 1920x1080 e 1280x720).
- A correção do MiniMax M3 (raciocínio desligado, provider fixo) no deploy: foi provada localmente (21 de 21 direto, 44 de 44 pelo hub); no deploy só rodou uma dinâmica de 9 celulares, sem medir falhas por modelo.
- Júri e música no `docker compose`: as duas rodadas do plano B pularam marcar blocos e tocar.
- A queda do MiniMax para o ElevenLabs e o cancelamento de geração demorada: só contra o fal.ai falso.
- Nome de bloco com 40 letras escrito por um modelo real no cartão do desfile.
- Um intervalo isolado de 14,8 s entre snapshots num celular, visto uma vez na carga de 25 celulares.

**Material**

- Os quatro vídeos da galeria (https://bloco-de-frevo-videos.vercel.app) foram gravados antes dos ajustes de palco: mostram o prompt antigo (muito "Oxe"), a tela final antiga e o cartão do desfile que cortava com refrão longo. Estão mudos. As instruções para gravar com som estão em `onde-esta-cada-coisa.md`.
- A galeria não tem link para o mundo ao vivo, de propósito; dá para acrescentar depois da apresentação.

**Revisão**

- O code-review de dois eixos cobriu os tickets #11 a #20. O diff do #21 (script de carga, documentos, três correções pequenas), o dos ajustes de palco (prompts, lista de bloqueio, tela final, catálogo do MiniMax) e o do PR #23 não passaram por ele.
- Uma proposta de nome ou refrão de um boneco silenciado ainda pode ir a voto e vencer; só o texto some do registro do telão.
- Pausar pelo admin congela o relógio e as perguntas, mas os modelos continuam sendo chamados: pausa longa gasta.

**Repositório**

- O PR #24 entrou como commit de merge, fora do squash que a regra 5 do `AGENTS.md` pede. Deixar só o squash habilitado nas configurações do repositório evita repetir.
- As keys seguem em `~/.config/gambiarra-lab/`, fora do repositório, de propósito; os outros artefatos estão em `artifacts/`.

**Contas, em 2026-11-11**

- OpenRouter: US$ 3,46 de saldo (`bun run frevo:spend`). A sessão gastou cerca de US$ 0,53.
- fal.ai: cerca de US$ 3,45 gastos, estimados, porque a key não lê o faturamento.
- Railway: US$ 0,05 de uso; o plano Hobby custa US$ 5 por mês. Como derrubar tudo depois do evento está em `apps/frevo/README.md`, seção "Deploy".
