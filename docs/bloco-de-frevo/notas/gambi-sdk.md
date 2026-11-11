# Gambi 0.7.2 (CLI e `gambi-sdk`): fatos para os tickets do Bloco de frevo

> Notas de exploração de 2026-11-11, escritas antes ou durante a implementação do Bloco de frevo. Podem estar desatualizadas: o código e `apps/frevo/README.md` valem mais do que elas.

## O que mudou depois

- O hospedeiro de modelos não registra o OpenRouter direto como diz a seção `createParticipantSession`: cada participant aponta para o proxy local de `apps/frevo/src/model-host/provider-proxy.ts`, que põe a key e os campos de cada modelo antes de chamar o OpenRouter.

Escrito pelo ticket #11 em 2026-11-11. Tudo abaixo foi observado rodando contra `gambi@0.7.2` / `gambi-sdk@0.7.2`, salvo onde diz "lido no código" (`node_modules/gambi-sdk/dist/index.js`).

O código que já embrulha isso no lab: `apps/frevo/src/gambi/room.ts` (Room por nome, participants, inference), `apps/frevo/src/model-host/host.ts` (sessões com reentrada), `apps/frevo/src/testing/processes.ts` (hub em porta livre). Use esses módulos em vez de repetir chamadas.

## Hub: `gambi hub serve`

- Flags: `--host`, `--port`, `--format text|json|ndjson`, `--mdns`, `--dry-run`, `--no-interactive`, `--env`, `--verbose`, `--quiet`. **Não existe flag de home.**
- O hub **ignora `PORT`** e **rejeita `--port 0`**. Para porta livre: pegue uma do SO, solte e passe por flag (`freePort()` em `testing/processes.ts`), com nova tentativa se o hub morrer antes de ficar pronto.
- Pronto quando imprime no stdout, com `--format ndjson`: `{"type":"started","timestamp":…,"data":{"host":"0.0.0.0","port":37057,"bindUrl":"http://0.0.0.0:37057","hubUrl":"http://localhost:37057"}}`. Ao parar: `signal_received` e `stopped`.
- O hub não escreveu nada no `HOME` nos meus testes (HOME temporário ficou vazio). Mesmo assim os testes dão um `HOME` temporário por hub, porque o CLI lê `~/.gambi` para `--env`.
- Health: `GET /v1/health` → 200 `{"data":{"status":"ok","timestamp":…},"meta":{"requestId":…}}`. `GET /health` é 404.
- Estado só em memória: **todo restart apaga as Rooms**; os codes novos são outros.
- CORS aberto (`Access-Control-Allow-Origin: *`) e nenhuma auth: nunca exponha.
- Logs de inferência saem como blocos multilinha `[gambi] llm.request {`, `[gambi] llm.complete {`, `[gambi] llm.error {` (console.info/error), misturados ao ndjson.

## Management plane (`/v1/...`)

Envelope: sucesso `{ data, meta: { requestId } }`; erro `{ error: { code, message, hint, details? }, meta }`.

- `POST /v1/rooms` body `{ name, password?, defaults? }` → 201 `{ data: { room: { id, code, name, hostId, createdAt, passwordProtected, participantCount }, hostId } }`. O `code` é gerado (6 caracteres, ex.: `S555BB`). **O nome não é único**: dois POST com o mesmo nome criam duas Rooms.
- `GET /v1/rooms` → `{ data: RoomSummary[] }`. **Descobrir a Room pelo nome = listar e filtrar por `name`.** O lab escolhe a mais antiga (`createdAt`) para todo processo escolher a mesma: `findRoomByName()` / `ensureRoom()`.
- `GET /v1/rooms/:code` → RoomSummary; 404 `ROOM_NOT_FOUND` depois de um restart do hub.
- `GET /v1/rooms/:code/participants` → `{ data: ParticipantSummary[] }`, cada um com `id, nickname, model, endpoint, specs, config, capabilities: { openResponses, chatCompletions }, connection: { kind: "tunnel", connected, lastTunnelSeenAt }, status: "online"|"busy"|"offline", joinedAt, lastSeen, updatedAt`. Participant de harness tem o campo `harness`. Um participant recém-registrado aparece com `connected: false` e `status: "offline"` até o túnel abrir.
- `PUT /v1/rooms/:code/participants/:id` (upsert; é o que `createParticipantSession` faz), `DELETE …/:id` (remove; **não fecha o WebSocket do túnel na hora**: a sessão só percebe no heartbeat seguinte, até 10 s), `POST …/:id/heartbeat`.
- O hub recusa `authHeaders` no corpo do upsert (400): credencial só fica do lado do participant.
- `GET /v1/rooms/:code/events` → SSE (`text/event-stream`). Cada evento: `event: <tipo>` e `data: {"type","timestamp","roomCode","data":{…}}`. Tipos: `connected`, `room.created`, `participant.joined`, `participant.updated`, `participant.left`, `participant.offline`, `llm.request`, `llm.complete`, `llm.error`, e os de harness. No SDK: `createClient({ hubUrl }).events.watchRoom({ roomCode, signal })` (AsyncIterable). **O stream é por code**: depois de um restart do hub é preciso reabrir no code novo.

### Eventos de inferência (capturados de verdade)

```json
{"type":"llm.request","timestamp":1794374256191,"roomCode":"WUR4A7","data":{"requestId":"8ad3753a-…","participantId":"frevo-fake-a-1","model":"frevo-fake-a-1","protocol":"chatCompletions"}}
{"type":"llm.complete","timestamp":1794374256202,"roomCode":"WUR4A7","data":{"requestId":"8ad3753a-…","participantId":"frevo-fake-a-1","model":"fake-a","protocol":"chatCompletions","metrics":{"ttftMs":11,"durationMs":11,"inputTokens":120,"outputTokens":24,"totalTokens":144,"tokensPerSecond":2181.8}}}
{"type":"llm.error","timestamp":1794374256206,"roomCode":"WUR4A7","data":{"requestId":"b22d52de-…","participantId":"frevo-fake-a-1","nickname":"fake-a 1","endpoint":"http://127.0.0.1:33391","model":"frevo-fake-a-1","protocol":"chatCompletions","stage":"dispatch","error":"Error: ECONNREFUSED: …"}}
```

- `llm.request.data.model` é o **seletor que o cliente mandou** (aqui, o participantId). `llm.complete.data.model` é o **modelo do participant** (`participant.model`). `llm.error.data.model` volta a ser o seletor.
- `requestId` é do hub (não é devolvido na resposta HTTP). Para correlacionar com um pedido seu, use `participantId` + ordem no tempo: o hub só atende um pedido por vez por participant.
- `metrics`: `ttftMs` (sem streaming é igual a `durationMs`), `durationMs`, `inputTokens`/`outputTokens`/`totalTokens` (vêm do `usage` do corpo da resposta; ausentes se o upstream não mandar `usage`), `tokensPerSecond` (ausente quando `durationMs` é 0).
- **`llm.error` só sai quando o despacho pelo túnel falha** (túnel fechado, upstream inalcançável): o cliente recebe 502 `{"error":"Failed to proxy request: …"}`. Lido no código: se o upstream responde com status HTTP de erro (401, 402, 429, 500), o hub repassa o status e o corpo e ainda emite `llm.complete` (sem tokens). Ou seja, "falhas por modelo" no painel não pode depender só de `llm.error`: conte também as respostas não-200 e as respostas sem chamada de ferramenta que o agendador vê.
- 409 e 404 por participant ocupado/ausente **não geram evento nenhum** (são recusados antes do `llm.request`).

## Inference plane (`/rooms/:code/v1/...`)

- `POST /rooms/:code/v1/chat/completions`. Sem envelope: a resposta é o JSON do upstream; erros são `{"error":"mensagem"}`.
- `GET /rooms/:code/v1/models` → lista só participants de modelo conectados; `id` é o participantId e `gambi.model` é o modelo real.
- **Seletor `model`** (lido no código e testado): `participantId` exato; `model:<nome>` ou o nome do modelo (primeiro participant livre com aquele modelo); `*` ou `any` (um livre ao acaso).
- **Um pedido por vez por participant.** Observado:
  - por participantId, participant ocupado → **409** `{"error":"Participant is already handling another request."}` (o spec fala em 404; com participantId é 409);
  - por nome de modelo ou `*` sem ninguém livre, ou id desconhecido → **404** `{"error":"No available participant for the requested model"}`;
  - participant com túnel fechado → 503 `Participant tunnel is not connected.` (lido no código);
  - Room inexistente (hub reiniciou) → 404 `Room not found`.
- A resposta **não diz quem atendeu**. Por isso o agendador escolhe o participant e manda o participantId.
- Abortar o `fetch` do cliente **não libera o participant no hub**: ele continua "ocupado" até o upstream responder. Um novo pedido para o mesmo participant nesse intervalo leva 409.

### O que atravessa o túnel

O hub faz `body: { ...request, model: participant.model }`: **todos os campos do corpo passam como vieram, só o `model` é trocado** pelo modelo do participant. Testado em `apps/frevo/src/model-host/host.test.ts`: `tools`, `tool_choice` (forçando a função), `max_tokens`, `stream: false` e um campo fora do padrão, `reasoning: { effort: "minimal" }`, chegam intactos ao upstream. A resposta volta com `choices[0].message.tool_calls[0].function.{name,arguments}` e `usage` inalterados.

O hub também aplica defaults da Room e do participant (`temperature`, `top_p`, `max_tokens`, `stop`, `seed`, `instructions` como mensagem de system) **só quando o pedido não traz o campo**. O lab não configura defaults.

Verificado com modelo real: `anthropic/claude-haiku-5.5` no OpenRouter devolveu a chamada de ferramenta forçada pelo hub em cerca de 1 s (`bun run frevo:real-check`).

O caminho Responses (`/rooms/:code/v1/responses`) não é usado: o fallback para chat/completions rejeita campos e só aceita tools de função.

## `createParticipantSession` (model participant)

```ts
createParticipantSession({
  endpoint,        // base SEM /v1: o SDK chama `${endpoint}/v1/chat/completions`
  authHeaders,     // Record<string,string>; vai só para o upstream (ex.: { Authorization: "Bearer …" })
  hubUrl, roomCode, participantId, nickname, model,
  capabilities?, config?, specs?, password?,
}): Promise<ParticipantSession>
// ParticipantSession: { participant, roomId, tunnel, close(), waitUntilClosed() }
// waitUntilClosed() → { reason: "closed" | "heartbeat_failed" | "tunnel_closed", error? }
```

- **OpenRouter**: `endpoint: "https://openrouter.ai/api"` (sem `/v1`) e `authHeaders: { Authorization: "Bearer <key>" }`. O `endpoint` fica visível no hub e nos eventos; a key não.
- Antes de registrar, o SDK **sonda o endpoint** (timeout de 5 s cada): `GET /api/tags`, `GET /v1/models`, `POST /v1/chat/completions` e `POST /v1/responses` com corpo `{}`. **Lança erro se `model` não estiver na lista de `/v1/models`** (`Model 'x' not found on …`). Um upstream falso precisa responder `/v1/models` e devolver 400 (não 404/405) ao POST vazio. A sondagem com `{}` deve dar 400 no OpenRouter, sem cobrança; o status não foi medido isoladamente, só que a entrada na Room funcionou com a key real.
- `participantId` vai na URL: sem `/`. O lab usa `frevo-<slug-do-modelo>-<n>`. O upsert com o mesmo id substitui o registro.
- **Não há reconexão automática.** A sessão manda ping no túnel e heartbeat HTTP a cada 10 s (`HEALTH_CHECK_INTERVAL`); o hub marca offline depois de 30 s sem sinal (`PARTICIPANT_TIMEOUT`, lido no código). Quando o WebSocket fecha (hub caiu) a sessão termina com `tunnel_closed`; quando o heartbeat falha (Room sumiu, participant removido) termina com `heartbeat_failed`. Quem quer continuar na Room precisa criar outra sessão: é o laço de `startModelHost()`, que procura a Room pelo nome de novo a cada tentativa.
- Tempos observados: depois de um restart do hub, Room recriada e hospedeiro de volta em poucos segundos (o passo inteiro do `frevo:smoke`, incluindo uma decisão nova, levou de 4 a 10 s com `retryMs` de 2 s); depois de um `DELETE` do participant, cerca de 10 s (espera o heartbeat).
- O túnel entrega um pedido por vez ao `fetch` do upstream; o corpo da resposta volta em pedaços base64 e o hub remonta.

## Como o lab usa (resumo)

| Preciso de | Use |
|---|---|
| Criar ou reaproveitar a Room pelo nome | `ensureRoom(hubUrl, name)` → `{ code, created }` |
| Achar a Room pelo nome | `findRoomByName(hubUrl, name)` |
| Participants de modelo conectados | `listModelParticipants(hubUrl, code)` → `{ id, model }[]` |
| Chamar um participant | `roomInference(hubUrl, () => code)` (lança `HubError` com `.status`) |
| Manter N participants na Room | `startModelHost({ hubUrl, roomName, models, upstream })` |
| Modelo falso sem rede | `startFakeUpstream({ models, latencyMs?, silent?, onRequest? })` |
| Hub em porta livre com HOME temporário | `startHub()` → `{ url, port, restart(), stop() }` |
| Processo filho com grupo próprio | `spawnProcess({ command, env, readyWhen })` |

Variáveis: `GAMBI_HUB_URL`, `FREVO_ROOM_NAME`, `FREVO_MODEL_HOST_MODE` (`openrouter`|`fake`), `FREVO_MODELS` (`modelo[:participants],…`), `OPENROUTER_API_KEY` ou `OPENROUTER_API_KEY_FILE`. Lista completa em `apps/frevo/README.md`.
