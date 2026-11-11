# Deploy do Bloco de frevo: Railway e docker compose

> Notas de exploração de 2026-11-11, escritas antes ou durante a implementação do Bloco de frevo. Podem estar desatualizadas: o código e `apps/frevo/README.md` valem mais do que elas.

## O que mudou depois

- Os rascunhos de `notes/railway/` viraram `deploy/frevo/`, `compose.yaml`, `.railway/railway.ts`, `.dockerignore` e `.railwayignore` no repositório. Os três serviços existem; o deploy de hoje está em `apps/frevo/README.md` ("Deploy").
- Os entrypoints são `apps/frevo/src/model-host/index.ts` e `apps/frevo/src/server/index.ts`, não os que a seção 4 supõe. O segredo do admin é criado com `openssl rand -hex 24`.
- Os ids do workspace, do ambiente, do serviço e do deploy foram tirados desta cópia; o id do projeto está em `apps/frevo/README.md`.

Notas de exploração para o ticket #12 (spec #10, seção "Deploy"). Escritas em 2026-11-11, com `railway` 5.71.0, `gambi` 0.7.2, Bun 1.4.3 (imagem) e Docker 29.9.3.

Cada afirmação está marcada: **[testado]** quer dizer que rodei e vi o resultado; **[lido]** quer dizer que vem da documentação oficial ou do `--help` e não foi exercitado.

Rascunhos de arquivo ficam em `notes/railway/`, já no caminho em que entrariam no repo:

| Rascunho | Estado |
|---|---|
| `railway/deploy/frevo/hub.Dockerfile` | [testado] local e na Railway |
| `railway/.railway/railway.ts` | bloco do `hub` [testado]; `modelos` e `mundo` passam no `tsc` e no `railway config plan` (2 a criar, 0 a mudar), não aplicados |
| `railway/aplicado/railway.hub-only.ts` | cópia exata do que está aplicado hoje no projeto |
| `railway/compose.yaml` | [testado] com stubs no lugar de `modelos` e `mundo` |
| `railway/deploy/frevo/modelos.Dockerfile`, `mundo.Dockerfile` | mecânica [testada] com stub; entrypoint e build da web dependem do #11 |
| `railway/deploy/frevo/secrets-entrypoint.sh` | [testado] |
| `railway/deploy/frevo/railway-setup.sh` | comandos exatos, cada bloco marcado |
| `railway/.dockerignore`, `railway/.railwayignore` | `.dockerignore` [testado]; `.railwayignore` [lido] |

## O que existe na Railway agora

| | |
|---|---|
| Workspace | plano Hobby, ativo desde 2026-11-11T05:15Z |
| Projeto `bloco-de-frevo` | `11908982-91b4-4956-bfe2-b68de2283d62` |
| Ambiente | `production` |
| Serviço | `hub`, deploy ativo em SUCCESS |
| Rede privada | `hub.railway.internal`, porta 3000, "IPv4 & IPv6" |
| Região | `us-east4-eqdc4a` (Virginia), 1 réplica |
| Domínio público do hub | nenhum (`railway domain list --service hub --json` devolve `{"domains": []}`) |
| Sleep | desligado (`sleepApplication: false` na instância) |
| Healthcheck | `/v1/health`, timeout 120 s; log do deploy: `[1/1] Healthcheck succeeded!` |

O hub está de pé, só ele. Os dois serviços descartáveis que criei (`sonda`, `sonda-repo`) foram apagados. O diretório do repo **não** está ligado ao projeto: trabalhei de um diretório fora dele. Para ligar: `railway link --project 11908982-91b4-4956-bfe2-b68de2283d62 --environment production` (grava em `~/.railway/config.json`, não no repo).

### Comandos exatos usados [testado]

Todos rodados de um diretório de trabalho que tinha `package.json`, `bun.lock`, `deploy/frevo/hub.Dockerfile`, `.railway/railway.ts` (a versão só-hub) e `node_modules/railway` (o SDK 3.16.0).

```bash
railway init --name bloco-de-frevo --workspace <id do workspace> --json
railway config plan                      # "Plan: 1 to add ... + Create service hub"
railway config apply --yes               # cria o serviço e as variáveis HUB_PORT e PORT
railway up --service hub --ci -m "hub: gambi 0.7.2 via IaC"   # 40 s, do upload ao "Deploy complete"
railway deployment list --service hub --json                  # status SUCCESS
railway logs --service hub --lines 20
railway logs --service hub --build --lines 80                 # mostra o healthcheck
railway domain list --service hub --json
railway private-network status --service hub --json
```

Prova de alcance pela rede privada: um serviço `sonda` (imagem `oven/bun:1.4.3-slim`, criado com `railway add --image oven/bun:1.4.3-slim --service sonda --json`) rodou um script Bun e logou:

```
SONDA {"AAAA":"1 registro(s)","A":"1 registro(s)","porNome":200,"porIPv6":200,"porIPv4":200,
       "criarSala":{"status":201,...},"listarSalas":"200 1 sala(s)"}
```

Ou seja: `fetch("http://hub.railway.internal:3000/v1/health")` do Bun funciona sem nenhuma opção, por nome, pelo AAAA e pelo A, e o management plane cria Room por ali. A sonda foi removida com `railway config apply --yes --confirm-destructive`.

## 1. Três serviços do mesmo repositório, pelo CLI

### `railway.json` por serviço não é mais o caminho

**[lido]** A doc de Config as Code abre com o aviso: `railway.json` / `railway.toml` estão depreciados, **serviço novo não pode optar por eles**, e os arquivos existentes deixam de ser lidos em **2026-12-01**. O substituto é Infrastructure as Code: um arquivo `.railway/railway.ts` para o projeto inteiro, avaliado pelo CLI (`railway config plan` / `apply`). A Railway não lê `.railway/` durante o deploy; quem aplica é o CLI, na máquina ou no CI.

O critério do #12 ("configuração como código por serviço") fica atendido por um arquivo só, com um bloco por serviço. Vale ajustar o texto do ticket.

**[testado]** O fluxo funciona de ponta a ponta com o hub. O DSL aceita por serviço: `build.builder`, `build.dockerfilePath`, `build.watchPatterns`, `deploy.healthcheckPath`, `deploy.healthcheckTimeout`, `deploy.multiRegionConfig`, `env` com literais, referências `${{...}}` e `preserve()`.

Requisitos do `railway config`:

- `railway` (npm) resolvível a partir de `.railway/railway.ts`: `bun add -d railway` na raiz. [testado com o pacote 3.16.0]
- **Node >= 22 no PATH**. O CLI avalia o arquivo com `node --experimental-strip-types`, não com Bun. Nesta máquina há Node 24. Num GitHub Action seria preciso `setup-node`. [testado: o erro de avaliação mostra `Node.js v24.17.0`]

### Criar projeto e serviços

```bash
railway init --name <nome> --workspace <id> --json     # [testado]
railway config apply --yes                             # [testado] cria os serviços do arquivo
railway add --service <nome> --json                    # [lido] alternativa imperativa
railway add --image <img> --service <nome> --json      # [testado]
railway add --repo owner/repo --branch main --service <nome> --json   # [testado]
```

`railway add` imprime linhas como `> Enter a variable` mesmo sem TTY, mas não bloqueia.

### Dockerfile por serviço

`build.dockerfilePath` no arquivo de IaC, relativo à raiz do que foi enviado. **[testado]** com `deploy/frevo/hub.Dockerfile`: o log de build mostra `load build definition from deploy/frevo/hub.Dockerfile`. O contexto de build é a raiz do upload (a raiz do repo), então `COPY package.json bun.lock ./` funciona.

**[lido]** Alternativa sem IaC: variável de serviço `RAILWAY_DOCKERFILE_PATH=deploy/frevo/hub.Dockerfile`.

### Variáveis sem o valor em log ou histórico

**[testado com valor fictício]**

```bash
railway variable set OPENROUTER_API_KEY --stdin --service modelos --skip-deploys --json \
  < ~/.config/gambiarra-lab/openrouter.key
```

- A saída é só `{"keys":["OPENROUTER_API_KEY"],"set":true}`.
- O valor não entra em argv (não aparece em `ps` nem no histórico do shell).
- O CLI corta a quebra de linha final (mandei 19 bytes com `\n`, ficaram 18). Os três arquivos em `~/.config/gambiarra-lab/` são valor cru, sem `NOME=` e sem `\n` no fim.
- `--skip-deploys` evita um deploy por variável.

Onde o valor **vaza**: `railway variable list --json` e `--kv`, `railway run env`, `railway config plan --show-values`, `railway config pull --include-variables`. Para conferir só os nomes: `railway variable list --service modelos --json | jq 'keys'`. O `railway config plan` sem flag esconde valores.

**[lido]** Variável selada (valor nunca mais legível por UI ou API) só se cria pelo painel (menu de três pontos, "Seal"). Não achei flag no CLI. Não é necessário para o evento.

### Variáveis e o IaC: `preserve()`

**[testado]** Por padrão o arquivo é dono de todas as variáveis dos serviços ("variables: managed"). Uma variável criada pelo CLI e ausente do arquivo vira `- Delete variable hub.X` no próximo plan. Declarada como `preserve()`, o plan fica limpo, **mesmo quando a variável ainda não existe**. Então a ordem é livre: pode aplicar o arquivo antes ou depois de pôr as keys.

### Domínio público só para um serviço

**[lido]** `railway domain --service mundo --port 3001 --json` gera um `*.up.railway.app`. `railway up` nunca expõe serviço sozinho. O domínio gerado não entra no `.railway/railway.ts`. O valor chega ao serviço em `RAILWAY_PUBLIC_DOMAIN` (no rascunho: `FREVO_PUBLIC_URL: "https://${{RAILWAY_PUBLIC_DOMAIN}}"`).

**[testado]** Sem rodar `railway domain`, o serviço fica sem domínio. O hub prova isso.

### Healthcheck

- **[lido]** A Railway bate em `healthcheckPath` na porta da variável `PORT` até receber 2xx, e só então troca o deploy ativo. Só acontece no deploy: não há monitoramento contínuo.
- **[testado]** O hub ignora `PORT`, então o serviço tem `PORT=3000` e `HUB_PORT=3000`: a primeira diz à Railway onde bater, a segunda é o que o `CMD` passa em `--port`. Sem `PORT` igual à porta real, o healthcheck falha com "service unavailable" [lido].
- **[lido]** O healthcheck chega com `Host: healthcheck.railway.app`. O hub não filtra host.
- `modelos` precisa de uma rota HTTP para ter healthcheck. Sugestão: um `Bun.serve` pequeno com `/health` que só devolve 200 quando entrou na Room. Depende do #11.

### Uma réplica, sem sleep, região

- **[testado]** `deploy.multiRegionConfig: { "us-east4-eqdc4a": { numReplicas: 1 } }` fixa região e réplica. `railway service list --json` mostra `configured: 1, running: 1`.
- **[testado]** Sleep nasce desligado (`sleepApplication: false` na API). Não precisa declarar, e não deve (ver armadilha da deriva).
- **[lido]** Regiões: `us-west2`, `us-east4-eqdc4a`, `europe-west4-drams3a`, `asia-southeast1-eqsg3a`. Virginia é a mais perto do Recife. Atalho: `railway scale --service hub us-east=1`.
- **[testado]** Serviço criado por `railway add` sem região cai em `us-west2`.

### `railway up` ou GitHub

**`railway up --service <nome> --ci`** [testado]: envia o diretório atual (respeita `.gitignore` e `.railwayignore`, ignora `.git` e `node_modules`), builda e deploya. Não depende de push. É o caminho para hoje, com o código ainda no branch.

**Origem no GitHub** [testado em parte]: `railway add --repo arthurbm/gambiarra-lab --branch main --service sonda-repo --json` funcionou sem interação e disparou na hora um deploy do commit `e26f3b8c` da `main`. Isso prova que o GitHub App da Railway enxerga o repo. Para serviço que já existe, o comando é:

```bash
railway service source connect --repo arthurbm/gambiarra-lab --branch main --service hub   # [lido]
```

O `--help` do `railway up` diz que esse é o jeito de trocar um serviço enviado localmente para autodeploy. Com a origem ligada, todo push na `main` deploya. Isso atende o critério do #21 ("depois do merge, o deploy reflete a main").

Cuidados com o autodeploy:

- Ligar a origem dispara um deploy da `main` na hora. Só ligar depois que a `main` tiver os Dockerfiles, senão o build falha (o deploy anterior continua ativo).
- Sem `watchPatterns`, qualquer push redeploya o serviço. Redeploy do `mundo` zera a dinâmica e redeploy do `hub` apaga as Rooms. **Não fazer merge na `main` durante a apresentação.**
- **[lido]** "Wait for CI" segura o deploy até o GitHub Actions passar. No DSL: `github(repo, { branch: "main", checkSuites: true })`.

Alternativa sem ligar o repo: um job no CI que roda `railway up --service X --ci` com um project token em `RAILWAY_TOKEN` [lido].

## 2. Rede privada, IPv6 e limites do proxy

### Rede privada

- **[testado]** Nome: `<serviço>.railway.internal`. O hub é `hub.railway.internal`. O serviço recebe o próprio nome em `RAILWAY_PRIVATE_DOMAIN`.
- **[testado]** Ambiente novo é dual-stack: o nome resolve A e AAAA, e os dois respondem. **[lido]** Ambientes criados antes de 2025-10-16 são só IPv6.
- **[lido]** Usar `http://`, não `https://` (o tráfego já vai por WireGuard). A porta é a que o processo escuta; não há mapeamento. Só existe em runtime, não no build. Não há custo de egress. Serviços de projetos ou ambientes diferentes não se enxergam.
- **[testado]** Referência entre serviços: `"http://${{hub.RAILWAY_PRIVATE_DOMAIN}}:${{hub.HUB_PORT}}"` como string literal no `env`. O plan aceita; a resolução acontece na Railway.

### O que o Bun precisa

**[testado]** em contêiner `oven/bun:1.4.3-slim`, numa rede Docker só IPv6 (`docker network create --ipv6 --ipv4=false`), que é o caso mais estrito:

| Caso | Resultado |
|---|---|
| `fetch("http://hub.railway.internal:3000/...")` com nome que só tem AAAA | 200, sem opção nenhuma |
| `Bun.serve({ hostname: "::" })` | atende IPv6 e IPv4 |
| `Bun.serve({ hostname: "0.0.0.0" })` | **recusa** conexão IPv6 (`ECONNREFUSED`) |
| `Bun.serve({})` sem hostname | atendeu IPv6 neste teste, mas reporta `hostname: "localhost"`; não confiar |
| `gambi hub serve --host :: --port 3000` | escuta em `*:3000`, atende os dois |
| `gambi room create --hub http://hub.railway.internal:3000` de outro contêiner | cria a Room |

Regra para `modelos` e `mundo`: `Bun.serve({ hostname: "::", port: Number(process.env.PORT) })`. O `fetch` e o `gambi-sdk` não precisam de nada.

### Proxy público: SSE

**[lido]** em "Specs & limits" e no guia "SSE vs WebSockets":

- Requisição HTTP fechada após **5 minutos sem dados**.
- Mesmo com dados fluindo, uma requisição HTTP dura **no máximo 15 minutos**. O spec só cita o primeiro limite; este segundo corta todo SSE aos 15 min.
- WebSocket é isento dos dois limites.
- SSE (`text/event-stream`) não é bufferizado nem comprimido na borda.
- Conexão HTTP/1.1 ociosa entre requisições fecha em 60 s. Cabeçalhos: 32 KB no total.

Consequência: o critério "sobrevive a dez minutos de conexão aberta" é alcançável, mas a reconexão não é opcional. O `EventSource` reconecta sozinho; o servidor deve mandar o estado completo ao conectar (ou honrar `Last-Event-ID`) e um `retry: 1000`.

**[testado]** O limite que morde antes é o do próprio Bun: `Bun.serve` fecha requisição ociosa em **10 segundos** por padrão (log: `Bun.serve() timed out a request after 10 seconds`). Medido com um SSE em Bun 1.4.4:

| Configuração | Resultado |
|---|---|
| padrão, sem keepalive | servidor derruba aos 12 s |
| padrão, keepalive a cada 15 s | derruba aos 12 s |
| padrão, keepalive a cada 5 s | aberta |
| `idleTimeout: 0` no `Bun.serve` | aberta |
| `server.timeout(req, 0)` na rota do SSE | aberta |

Recomendação: `server.timeout(req, 0)` na rota do SSE **e** um comentário `: ka\n\n` a cada 15 a 20 s (bem abaixo dos 5 min da Railway, e detecta cliente morto).

### O SSE de eventos do hub cai sozinho

**[testado]** `GET /v1/rooms/<code>/events` no hub 0.7.2 manda `event: connected` e, se nenhum evento passar, **a conexão é fechada pelo hub aos ~12 s** (`curl` sai com código 18, duas vezes seguidas; o log do hub mostra o mesmo aviso de timeout do `Bun.serve`). O hub não manda keepalive.

Isso afeta o painel dos modelos, que lê `llm.complete` e `llm.error` desse stream: quem assina precisa reconectar em laço e aceitar que eventos durante a reconexão podem se perder. Com decisões saindo o tempo todo o stream fica vivo, mas na fase de entrada ele vai cair repetidamente. Vale contar as métricas também pelo lado de quem chama (o agendador sabe latência e falha de cada chamada).

**[testado]** A inferência não sofre disso: um `chat/completions` sem streaming atravessou o hub com o modelo falso demorando 14 s e 25 s, e voltou 200 nos dois casos.

## 3. O hub na Railway

Feito e descrito no topo. Detalhes do Dockerfile, todos **[testado]**:

- O pacote `gambi` é um wrapper `#!/usr/bin/env node` com `postinstall`. A imagem `oven/bun` não tem Node de verdade (tem um `node` que é link para o Bun) e o Bun bloqueia o `postinstall` (`Blocked 1 postinstall`). O Dockerfile evita os dois: copia o binário real de `node_modules/gambi-linux-x64/bin/gambi` para `/usr/local/bin/gambi` e chama direto.
- A versão sai do `bun.lock` do repo (`grep` de `"gambi@x.y.z"`), então a nuvem usa o mesmo 0.7.2 do `bun run dev:hub`.
- `CMD ["sh","-c","exec gambi hub serve --host :: --port \"${HUB_PORT}\" --format ndjson --no-interactive"]`. O `exec` faz o SIGTERM chegar: para em 0,25 s e loga `signal_received` e `stopped`.
- Roda como usuário `bun` (uid 1000). Imagem de 281 MB (o binário tem 110 MB).
- Rota de saúde do hub: **`/v1/health`** (`/health` devolve 404).
- Consumo medido na Railway: 15 MB de RAM, CPU média de 0,0002 vCPU.

Estado do hub é só memória: todo redeploy ou restart apaga as Rooms. Já era premissa do spec; a novidade é a lista do que causa redeploy (abaixo).

## 4. `docker compose` no notebook

Rascunho em `railway/compose.yaml`. **[testado]** com o repo de verdade (`git archive HEAD`), o hub real e um stub Bun no lugar de `modelos` e `mundo`:

- `docker compose up --build -d --wait` ficou saudável em 40 s (com as camadas base em cache).
- Ordem: `hub` fica `healthy`, depois sobem `modelos` e `mundo` (`depends_on: condition: service_healthy`).
- `mundo` e `modelos` alcançam `http://hub:3000` por nome e por IPv6 (`enable_ipv6: true` na rede).
- O hub não publica porta no host. Só `mundo` publica (`3001`).
- `bun install --frozen-lockfile` do monorepo inteiro funciona dentro de `oven/bun:1.4.3-slim`.

### Keys

Os arquivos em `~/.config/gambiarra-lab/` guardam o valor cru, então **`env_file` não serve** (ele exige `NOME=valor`). O rascunho usa `secrets` do compose com `file: ${HOME}/.config/gambiarra-lab/<arquivo>`, montados em `/run/secrets/<nome>`. O `secrets-entrypoint.sh` transforma cada `FOO_FILE` em `FOO`, para o código ler as mesmas variáveis que lê na Railway.

**[testado]**:

- `modelos` recebeu só `OPENROUTER_API_KEY`; `mundo` recebeu só `FAL_KEY` e `FREVO_ADMIN_SECRET`. O stub logou presença e tamanho, nunca o valor.
- `docker inspect` do contêiner mostra `OPENROUTER_API_KEY_FILE=/run/secrets/openrouter_key` e nenhuma `OPENROUTER_API_KEY=`.
- A imagem não contém arquivo `.key` nem `/run/secrets`. O `.dockerignore` barra `**/*.key` e `**/*.secret` do contexto.
- O secret chega com o modo e o dono do arquivo do host (`-rw------- 1000 1000`). Funciona porque o usuário `bun` da imagem é uid 1000, igual ao do host nesta máquina. Em máquina com outro uid, o contêiner não lê o arquivo: aí rodar o serviço com `user: "${UID}"` ou como root.

Falta criar o segredo do admin, que ainda não existe na pasta:

```bash
(umask 077; openssl rand -hex 16 > ~/.config/gambiarra-lab/admin.secret)
```

Sem esse arquivo o `docker compose up` falha ao montar o secret.

### O que depende do código do #11

- Caminho dos entrypoints. O rascunho supõe `apps/frevo/src/modelos.ts` e `apps/frevo/src/mundo.ts`.
- Build da web. O rascunho supõe um app Vite em `apps/frevo-web` com `bun run build`, servido como estático pelo servidor do mundo. Se o diretório não existir, o Dockerfile pula o passo.
- Rotas de saúde: supus `/health` em `modelos` (porta 3002) e em `mundo` (porta 3001).
- Nomes de variável: `GAMBI_HUB_URL` já é a convenção do board. `FREVO_ROOM_NAME`, `FREVO_PUBLIC_URL`, `FREVO_ADMIN_SECRET`, `OPENROUTER_API_KEY` e `FAL_KEY` são proposta.
- Os dois Dockerfiles instalam o monorepo inteiro: imagem de 943 MB. Funciona e cabe no limite, mas dá para enxugar depois com `bun install --filter`.

## 5. Custos

### Preço

**[lido]** em "Pricing plans":

| Recurso | Preço |
|---|---|
| RAM | US$ 0,000231 por GB por minuto (US$ 10 por GB por mês) |
| CPU | US$ 0,000463 por vCPU por minuto (US$ 20 por vCPU por mês) |
| Egress | US$ 0,05 por GB |
| Build | grátis |
| Tráfego na rede privada | grátis |

Cobrança por minuto de uso real, não pelo limite do contêiner.

### Três serviços pequenos por um dia

O hub é medido; `modelos` e `mundo` são estimativa minha, porque o código não existe.

| Serviço | RAM | CPU média | Custo por dia |
|---|---|---|---|
| hub (medido: 15 MB, 0,0002 vCPU) | 0,03 GB com folga | ~0 | US$ 0,01 |
| modelos (estimado) | 0,10 GB | 0,01 vCPU | US$ 0,04 |
| mundo (estimado) | 0,15 GB | 0,03 vCPU | US$ 0,07 |
| egress (estimado, 0,5 GB) | | | US$ 0,03 |
| **Total** | | | **cerca de US$ 0,15 por dia** |

Ligado o mês inteiro daria uns US$ 4,50 de uso.

### A assinatura pesa mais que o uso

A primeira tentativa de criar o projeto falhou com a mensagem exata:

```
Your trial has expired. Please select a plan to continue using Railway.
```

(`projectCreate`, código `BAD_USER_INPUT`; o workspace estava com `customer.state: INACTIVE` e sem assinatura.) O host fez o upgrade e o workspace passou a `ACTIVE` no plano **Hobby**, com período de cobrança de 2026-11-11 a 2026-12-11.

**[lido]** O Hobby custa **US$ 5 por mês** e inclui US$ 5 de uso. Com o uso estimado acima, a conta do mês é US$ 5 cravados, o que já passa do teto de US$ 3 que o spec dá para a Railway. O gasto de recursos deste trabalho foi de centavos (`estimatedBillDollars` de US$ 0,00002 ao fim dos testes); a diferença é a assinatura. Fica para o host decidir se ajusta o teto no spec.

### Consultar e limitar

```bash
railway usage                                             # [testado] resumo do período
railway usage --json
railway usage projects --project bloco-de-frevo --json    # [lido] por serviço
railway metrics --service hub --json                      # [testado] CPU e RAM reais
railway usage limit status                                # [lido]
railway usage limit set --target workspace --soft 3       # [lido] só e-mail de alerta
```

**[lido]** O limite rígido (que desliga tudo ao estourar) tem mínimo de US$ 10, então não dá para travar em US$ 3. Dá para pôr alerta por e-mail em qualquer valor. Não configurei nenhum limite.

Logo após o primeiro deploy, `railway usage projects` ainda devolvia `projectCount: 0`: o uso demora a aparecer.

Para parar de gastar depois do evento: `railway scale --service <nome> us-east=0` por serviço, ou `railway delete --project 11908982-91b4-4956-bfe2-b68de2283d62 --yes`. A assinatura continua até ser cancelada no painel.

## Armadilhas encontradas

1. **Config as Code acabou para serviço novo.** `railway.json` por serviço não é opção; usar `.railway/railway.ts`. [lido]
2. **Valor padrão escrito no IaC vira deriva eterna.** Com `sleepApplication: false`, `restartPolicyType: "ON_FAILURE"` e `restartPolicyMaxRetries: 10` no arquivo, todo `plan` mostrava `null → valor` e todo `apply` **redeployava o hub**, apagando as Rooms. Tirei os três e o plan ficou limpo. [testado]
3. **`timeout railway config plan` quebra.** O SDK descobre o CLI por `$_`; com `timeout` na frente ele roda `timeout --version` e falha com `This version of railway/iac requires Railway CLI 5.42.1 or newer`. Vale para qualquer wrapper. [testado]
4. **`railway environment edit` com dois `--service-config` travou** por mais de 3 minutos sem aplicar nada. Fiz a mesma mudança pelo arquivo de IaC. [testado]
5. **Apagar variável pelo IaC redeploya o serviço.** Mexer em variável do hub derruba as Rooms. [testado]
6. **`apply --yes` recusa mudança destrutiva**; precisa de `--confirm-destructive`. Como o arquivo é dono do projeto inteiro, um serviço criado por fora e ausente do arquivo entra no plan como `Delete service`. [testado]
7. **`Bun.serve` mata SSE ocioso em 10 s.** Vale para o `mundo` e já acontece no SSE de eventos do hub. [testado]
8. **SSE pelo proxy público dura no máximo 15 min**, mesmo com keepalive. [lido]
9. **`0.0.0.0` não atende IPv6.** Usar `::`. [testado]
10. **A rota de saúde do hub é `/v1/health`.** [testado]
11. **O healthcheck usa `PORT`.** Como o hub ignora `PORT`, a variável tem de repetir a porta da flag. [testado que funciona assim; lido que falha sem]
12. **O wrapper do `gambi` não roda em `oven/bun`** sem o atalho do binário direto. [testado o atalho]
13. **`env_file` não lê os arquivos de key** (valor cru). Usar `secrets`. [testado]
14. **Ligar o repo dispara deploy da `main` na hora**, e sem `watchPatterns` todo push redeploya. [testado o disparo]
15. **`railway variable list --json` imprime os valores.** Não usar para conferir. [lido no `--help`]
16. **`railway add` sem região cai em `us-west2`.** Fixar a região no IaC. [testado]

## Fontes

- Documentação oficial, lida em markdown de `https://docs.railway.com/<página>.md`: `config-as-code`, `config-as-code/reference`, `infrastructure-as-code`, `infrastructure-as-code/reference`, `cli/config`, `cli/up`, `deployments/healthchecks`, `deployments/monorepo`, `deployments/serverless`, `deployments/regions`, `deployments/github-autodeploys`, `builds/dockerfiles`, `networking/private-networking` (e `how-it-works`, `library-configuration`), `networking/public-networking/specs-and-limits`, `guides/sse-vs-websockets`, `variables`, `pricing`, `pricing/plans`, `pricing/free-trial`, `pricing/cost-control`.
- `railway <comando> --help` da versão 5.71.0.
- Tipos do pacote npm `railway@3.16.0` (`railway/iac`), para os campos do DSL que a referência não lista (`build.dockerfilePath`, `deploy.sleepApplication`, `deploy.multiRegionConfig`).
