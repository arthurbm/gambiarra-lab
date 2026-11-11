# Modelos do Bloco de frevo no OpenRouter

> Notas de exploração de 2026-11-11, escritas antes ou durante a implementação do Bloco de frevo. Podem estar desatualizadas: o código e `apps/frevo/README.md` valem mais do que elas.

## O que mudou depois

- O MiniMax M3 vai hoje com `reasoning: { effort: "none" }` e provider fixo (`order: ["coreweave", "minimax"]`, `require_parameters: true`), não com o corpo da seção 2. Sob carga o OpenRouter o roteou para a Venice, que raciocinava até `max_tokens` e respondia sem chamada de ferramenta (16 de 21 numa rajada). O corpo que vale é o de `apps/frevo/src/models/catalog.ts`.
- O hub repassa `reasoning`, `provider` e `tool_choice` até o upstream (testado em `apps/frevo/src/model-host/host.test.ts`), e o hospedeiro seguiu o padrão sugerido no fim da seção 8: um proxy local mescla o corpo por modelo e põe o `Authorization`.
- O saldo e o uso da seção 5 são de 2026-11-11. Para o saldo de hoje, `bun run frevo:spend` (a documentação de hoje diz que `GET /credits` pede uma management key).
- A sonda (`openrouter-probe.ts`) e as 785 chamadas registradas não vieram para o repositório; a seção 10 descreve um script que não está aqui. Para medir pelo hub, `bun run frevo:real-check` e `scripts/frevo-text-check.ts`.

Notas para o ticket #18 (spec #10, seção "Como os bonecos pensam"). Medido em 2026-11-11 entre 05:05 e 05:16 UTC (02:05 a 02:16 no Recife), direto contra `https://openrouter.ai/api/v1/chat/completions`, sem passar pelo hub do Gambi.

A sonda gravou uma linha por chamada (785 chamadas), com corpo mesclado, provider, tokens, custo, latência e argumentos devolvidos. Esses arquivos não vieram para o repositório.

## Resumo

- Os cinco IDs do spec existem e aceitam `tools` e `tool_choice`.
- Com o raciocínio no mínimo, **os cinco devolvem chamada de ferramenta válida em 10 de 10** na bateria final, e em 100% das 457 chamadas feitas com esforço mínimo (86 a 102 por modelo).
- A falha de 2026-11-11 foi reproduzida: com o raciocínio padrão e `max_tokens` apertado, `z-ai/glm-5.3-flash` cai para 6/10, `minimax/minimax-m3.1-flash` para 7/10 e `deepseek/deepseek-v4.1-flash-1017` para 9/10. São os três que raciocinam por padrão em esforço `max` ou `high`.
- **Troca proposta: `minimax/minimax-m3.1-flash` por `minimax/minimax-m3`.** O M3.1 Flash passa no critério de ferramenta (90/90), mas põe caracteres chineses ou lixo de token em cerca de 12% das falas (9 de 73 com temperatura padrão, 2 de 40 com temperatura baixa), e essas falas vão para o telão. O M3 é do mesmo fornecedor, não raciocina, deu 91/91, zero vazamento em 91 falas e foi o mais rápido de todos (p50 0,63 s).
- Reserva de outro fornecedor, caso algum modelo caia no dia: `google/gemini-3.5-flash-lite` (30/30, p50 1,4 s).
- Carga: 12 chamadas simultâneas por 4 ondas e 25 bonecos decidindo a cada 4 s por 49 s (220 chamadas, 4,45 por segundo) passaram sem nenhum 429 nem 402, todas válidas.
- Custo medido: US$ 0,000125 por decisão na média dos cinco modelos de palco. Uma dinâmica inteira fica entre US$ 0,25 e US$ 0,40.
- Gasto desta exploração: **US$ 0,105** (soma de `usage.cost` das 785 chamadas), dentro do teto de US$ 0,40. O uso da key subiu mais do que isso porque outro processo usa a mesma key ao mesmo tempo; ver "Gasto".

## 1. Catálogo (`GET /api/v1/models`)

Preços em US$ por milhão de tokens. O preço do catálogo é o do endpoint mais barato; o preço efetivo depende do provider que atende.

| Modelo | Entrada | Saída | `tools` | `tool_choice` | Raciocínio | Esforços aceitos | Padrão | Endpoints |
|---|---|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 0,10 | 0,50 | sim | sim | opcional | max, xhigh, high, medium, low, none | medium | 10 |
| `minimax/minimax-m3.1-flash` | 0,15 | 0,60 | sim | sim | **obrigatório** | max, xhigh, high, medium, low | max | 11 |
| `openai/gpt-6-luna` | 0,10 | 0,50 | sim | sim | opcional | max, xhigh, high, medium, low, none | medium | 8 |
| `deepseek/deepseek-v4.1-flash-1017` | 0,006 | 0,50 | sim | sim | opcional | max, high, low, none | high | 48 |
| `z-ai/glm-5.3-flash` | 0,0399 | 0,0784 | sim | sim | **obrigatório** | max, high, low | max | 41 |
| `minimax/minimax-m3` (substituto) | 0,30 | 1,20 | sim | sim | não tem | n/a | n/a | n/a |
| `google/gemini-3.5-flash-lite` (reserva) | 0,30 | 2,50 | sim | sim | obrigatório | high, medium, low, minimal | minimal | n/a |

Detalhes de `supported_parameters` que mudam a configuração:

- `reasoning`, `reasoning_effort`, `include_reasoning`, `max_tokens`, `response_format`, `structured_outputs`, `tools` e `tool_choice` estão nos cinco.
- **Haiku 5.5 e GPT-6 Luna não listam `temperature`, `top_p` nem `top_k`.** A documentação do OpenRouter diz que o Haiku 5.5 recusa `temperature` diferente de 1. No teste, `temperature: 0.7` foi aceito sem erro nos dois (2/2 cada), então o OpenRouter descarta o campo. Melhor não enviar.
- `parallel_tool_calls` só existe em DeepSeek e GLM. Não é necessário: nenhum modelo devolveu mais de uma chamada.
- MiniMax e GLM têm raciocínio obrigatório: `reasoning: {"enabled": false}` e `{"effort": "none"}` devolvem `400 Reasoning is mandatory for this endpoint and cannot be disabled.` antes de rotear. O mínimo deles é `low`.
- O MiniMax M3.1 Flash tem preço por horário: metade (0,075 / 0,30) entre 15:00 e 01:00 UTC. A demo às 16h40 do Recife (19:40 UTC) cai na faixa barata.
- Preços por provider variam muito nos modelos de peso aberto. DeepSeek: de 0,006 a 0,60 na entrada e de 0,15 a 2,40 na saída. GLM: de 0,04 a 0,19 na entrada e de 0,08 a 0,625 na saída.

## 2. Corpo recomendado por modelo

Corpo comum a todos (o que o agendador manda):

```json
{
  "model": "<id>",
  "stream": false,
  "messages": [{ "role": "system", "content": "..." }, { "role": "user", "content": "..." }],
  "tools": [{ "type": "function", "function": { "name": "decidir", "description": "...", "parameters": { "...": "..." } } }]
}
```

Campos por modelo, prontos para virar configuração (mesclar por cima do corpo comum):

```json
{
  "anthropic/claude-haiku-5.5": {
    "tool_choice": "required",
    "max_tokens": 400,
    "reasoning": { "effort": "none" }
  },
  "minimax/minimax-m3": {
    "tool_choice": "required",
    "max_tokens": 400
  },
  "openai/gpt-6-luna": {
    "tool_choice": "required",
    "max_tokens": 400,
    "reasoning": { "effort": "none" }
  },
  "deepseek/deepseek-v4.1-flash-1017": {
    "tool_choice": "required",
    "max_tokens": 400,
    "reasoning": { "effort": "none" },
    "provider": { "sort": "latency", "require_parameters": true }
  },
  "z-ai/glm-5.3-flash": {
    "tool_choice": "required",
    "max_tokens": 400,
    "reasoning": { "effort": "low", "exclude": true },
    "provider": { "sort": "latency", "require_parameters": true }
  },
  "minimax/minimax-m3.1-flash": {
    "tool_choice": "required",
    "max_tokens": 400,
    "temperature": 0.3,
    "reasoning": { "effort": "low", "exclude": true },
    "provider": { "sort": "latency", "require_parameters": true }
  },
  "google/gemini-3.5-flash-lite": {
    "tool_choice": "required",
    "max_tokens": 400,
    "reasoning": { "effort": "minimal" }
  }
}
```

Os cinco primeiros são os de palco. O sexto é o do spec que a nota propõe trocar; o sétimo é a reserva.

### Resultado com o corpo recomendado

Bateria final: 10 tentativas por modelo, 2 simultâneas, cinco cenários diferentes em rodízio. "Válida" é argumento que faz parse e passa no schema da ferramenta. Latência é o tempo de parede da requisição HTTP, medido do Recife.

| Modelo | Válidas | p50 | p95 | Tokens entrada / saída / raciocínio | Custo por decisão | Provider que atendeu |
|---|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 10/10 | 1,27 s | 1,51 s | 1347 / 135 / 0 | US$ 0,000202 | Claude Platform on AWS |
| `minimax/minimax-m3` | 10/10 | 0,64 s | 1,14 s | 919 / 65 / 0 | US$ 0,000154 | CoreWeave |
| `openai/gpt-6-luna` | 10/10 | 1,34 s | 2,81 s | 520 / 50 / 0 | US$ 0,000077 | OpenAI |
| `deepseek/deepseek-v4.1-flash-1017` | 10/10 | 0,97 s | 1,75 s | 881 / 99 / 0 | US$ 0,000162 | InferenceNet (9), BaseTen (1) |
| `z-ai/glm-5.3-flash` | 10/10 | 1,47 s | 1,73 s | 747 / 65 / 4 | US$ 0,000076 | InferenceNet |
| `minimax/minimax-m3.1-flash` | 10/10 | 1,26 s | 1,76 s | 956 / 115 / 21 | US$ 0,000083 | Fireworks |
| `google/gemini-3.5-flash-lite` | 10/10 | 1,43 s | 1,57 s | 501 / 48 / 0 | US$ 0,000269 | Google |

Amostra maior com o mesmo corpo (bateria final, rajada e carga sustentada somadas):

| Modelo | Válidas | p50 | p95 | Máximo | Custo médio |
|---|---|---|---|---|---|
| `anthropic/claude-haiku-5.5` | 66/66 | 1,21 s | 1,51 s | 1,73 s | US$ 0,000202 |
| `minimax/minimax-m3` | 71/71 | 0,63 s | 1,09 s | 1,14 s | US$ 0,000141 |
| `openai/gpt-6-luna` | 58/58 | 1,42 s | 2,31 s | 2,81 s | US$ 0,000076 |
| `deepseek/deepseek-v4.1-flash-1017` | 61/61 | 1,24 s | 1,80 s | 2,05 s | US$ 0,000149 |
| `z-ai/glm-5.3-flash` | 62/62 | 1,16 s | 1,73 s | 2,12 s | US$ 0,000068 |

O mesmo prompt custa tokens de entrada bem diferentes: 520 no Luna e 1347 no Haiku (tokenizer novo mais o prompt de sistema de ferramenta). Por isso o Haiku é o mais caro por decisão, mesmo com preço de tabela igual ao do Luna.

## 3. O que cada alavanca faz

### Raciocínio

| Modelo | Sem `reasoning` (padrão) | Com o mínimo |
|---|---|---|
| Haiku 5.5 | 0 tokens de raciocínio com ferramenta forçada (o modelo pula o raciocínio); 31 em média com `tool_choice: "auto"` | `effort: "none"`: 0 |
| GPT-6 Luna | 0 a 9 em média, máximo 86 | `effort: "none"`: 0 |
| DeepSeek V4.1 Flash | 7 a 43 em média, máximo 180 | `effort: "none"`: 0 |
| MiniMax M3.1 Flash | 50 a 55 em média, máximo 300 (o limite) | `effort: "low"`: 11 a 27 em média, máximo 172 |
| GLM 5.3 Flash | 72 a 114 em média, máximo 300 (o limite) | `effort: "low"`: 1 a 5 em média, máximo 46 |

- No Haiku e no Luna o campo `reasoning` é uma garantia: se o `tool_choice` se perder no caminho, o modelo não começa a raciocinar.
- `reasoning.exclude: true` só tira o texto de raciocínio da resposta. Os tokens continuam contando e sendo cobrados. Vale nos dois modelos de raciocínio obrigatório para a resposta vir menor.
- `reasoning.max_tokens` não foi usado: a documentação diz que modelos que só aceitam esforço convertem o valor em nível de esforço.

### `max_tokens`

Raciocínio e resposta dividem o mesmo limite. É a causa da falha de 2026-11-11.

| Modelo | Padrão, `max_tokens: 300`, ferramenta forçada | Padrão, `max_tokens: 300`, `tool_choice: "auto"` | Padrão, `max_tokens: 150`, ferramenta forçada | Mínimo, `max_tokens: 300` ou `400` |
|---|---|---|---|---|
| Haiku 5.5 | 14/14 | 10/10 | não testado | 86/86 |
| GPT-6 Luna | 14/14 | 10/10 | não testado | 78/78 |
| DeepSeek V4.1 Flash | 14/14 | 10/10 | 9/10 | 101/101 |
| MiniMax M3.1 Flash | 14/14 | 9/10 | **7/10** | 90/90 |
| GLM 5.3 Flash | 12/14 | 8/10 | **6/10** | 102/102 |

Duas formas de falha, as duas por limite de tokens:

1. `finish_reason: "length"`, sem `tool_calls` e sem `content`: o modelo gastou tudo raciocinando.
2. `finish_reason: "tool_calls"` com argumentos cortados que ainda fazem parse: `{"acao":"fal"}`, `{"acao":"falar","alvo":"Surdo Samuca"}` sem `fala`, ou `{}`. **Checar só "veio tool call e o JSON faz parse" deixa isso passar.** É preciso validar contra o schema.

Com esforço mínimo, a maior resposta vista foi de 253 tokens (MiniMax M3.1 Flash, 172 de raciocínio); nos outros ficou abaixo de 160. `max_tokens: 400` dá folga para a decisão. Chamadas com saída maior (refrão de dois a quatro versos, maestro) pedem um limite próprio, algo como 700.

Sempre enviar `max_tokens`: além de limitar o raciocínio, é o que o OpenRouter usa para reservar crédito por requisição (ver "Limites").

### `tool_choice`

- A forma nomeada (`{"type":"function","function":{"name":"decidir"}}`) e `"required"` deram 10/10 nos cinco modelos com esforço mínimo.
- **O endpoint first-party da Z.AI recusa a forma nomeada**: `400 Tool choice must be auto, none, or required`. Com a forma nomeada o roteador simplesmente pula a Z.AI. Com uma única ferramenta, `"required"` tem o mesmo efeito e todos aceitam, então é a forma recomendada para os cinco.
- `"auto"` com instrução no prompt também funcionou no Haiku, no Luna e no DeepSeek (10/10 cada), mas é a forma em que MiniMax e GLM mais raciocinam.
- Segundo a documentação do OpenRouter, Sonnet 5.5 e Opus 5.5 recusam ferramenta forçada. O Haiku 5.5 aceita. Vale lembrar se alguém quiser trocar o Haiku por um Claude maior.

### `provider`

- Haiku e Luna: sem bloco `provider`. O roteamento padrão foi 100% para "Claude Platform on AWS" e "OpenAI".
- DeepSeek e GLM têm dezenas de providers, com quantizações de fp4 a fp8. No roteamento padrão cada chamada cai num provider diferente, e a cauda aparece: 12,7 s na OpenInference e 11 s em outra chamada do GLM, 3,6 s na Alibaba para o DeepSeek.
- `provider.sort: "latency"` concentra no provider mais rápido do momento (InferenceNet para os dois, Fireworks para o MiniMax M3.1 Flash) e mantém o fallback automático. Com ele o p95 do GLM caiu de 3,9 a 12,7 s para 1,7 a 2,5 s.
- `provider.require_parameters: true` tira da rota os endpoints que não aceitam algum campo enviado. Sem ele o provider ignora o campo em silêncio; no GLM, por exemplo, o endpoint `tenstorrent/fp8` não lista `tool_choice`.
- Fixar o first-party não compensa: a Z.AI recusa a forma nomeada de `tool_choice`; o endpoint `deepseek` está bloqueado pela configuração de privacidade da conta (`404 ... Paid model training violation (account settings)`, ajustável em openrouter.ai/settings/privacy; não mexi); o endpoint `minimax` respondeu em 2,9 s contra 0,9 s da Together.
- A medição foi às 02h do Recife. `sort: "latency"` se adapta ao horário, uma lista fixa em `provider.order` não. Vale rodar a bateria final de novo perto do horário da demo (custa cerca de US$ 0,01).

### Temperatura

Só usei no MiniMax M3.1 Flash, para tentar reduzir o vazamento de idioma (seção 4). Os outros foram medidos com a temperatura padrão.

## 4. Troca proposta: MiniMax M3.1 Flash por MiniMax M3

O `minimax/minimax-m3.1-flash` cumpre o critério do ticket (chamada válida em 90/90 com esforço mínimo). O problema é o texto:

- 9 de 73 falas válidas com temperatura padrão tinham caracteres chineses ou lixo de token, em todos os providers, inclusive o first-party. Exemplos literais:
  - `Ô meu人力资源 do Frevo, bora pra onde hoje?` (Nebius)
  - `Ô meu的人类, qual som você mais gosta? Maracatu ou frevo?` (Minimax)
  - `Ô meu家门, pra começarmos: som de maracatu ou与发展论?` (DigitalOcean)
  - `Cê tá afim de maracatu hoje, meuSponsored?` (Fireworks)
- Com `temperature: 0.3` caiu para 1 de 20 (`Vou pro coreto,、若`), e com `temperature: 0.7, top_p: 0.8` também 1 de 20. Na bateria final (10 falas) não apareceu.
- O vazamento costuma vir logo depois de um vocativo para o humano ("Ô meu ...").

Substitutos testados com 20 tentativas cada (`tool_choice: "required"`, raciocínio no mínimo):

| Candidato | Válidas | p50 | p95 | Custo por decisão | Observação |
|---|---|---|---|---|---|
| `minimax/minimax-m3` | 20/20 (91/91 no total) | 0,76 s | 0,95 s | US$ 0,00014 a 0,00020 | Mesmo fornecedor, sem raciocínio, zero caractere fora do latim em 91 falas. Um erro de digitação visto (`boraonde`). |
| `google/gemini-3.5-flash-lite` | 20/20 (30/30 no total) | 1,73 s | 2,00 s | US$ 0,00027 | Outro fornecedor. Português limpo. O mais caro por decisão. |
| `qwen/qwen3.8-flash` | 20/20 | 6,77 s | 10,0 s | US$ 0,00007 | Descartado: lento demais (só o provider Alibaba). |
| `xiaomi/mimo-v2.6-flash` | 20/20 | 1,83 s | 7,43 s | US$ 0,00011 | Descartado: cauda de 7 a 9 s. |

Recomendação: trocar pelo `minimax/minimax-m3`. Mantém MiniMax como fornecedor no painel, é o mais rápido da sala e tira o risco de chinês no telão. Se o M3.1 Flash ficar mesmo assim, usar `temperature: 0.3` e recusar no servidor qualquer fala com caractere fora do alfabeto latino (conta como resposta inválida e entra na repetição). Esse filtro é barato e vale para todos os modelos: o GLM também soltou um katakana em 1 de 66 falas com raciocínio padrão (`Responde proカバー aí`).

Os outros quatro modelos do spec ficam.

## 5. Limites, concorrência e custo

### O que a documentação diz

- Modelos pagos não têm teto de requisições por minuto na plataforma. Os tetos de 20 por minuto valem só para variantes `:free`. O campo `rate_limit` de `GET /api/v1/key` está obsoleto (`requests: -1`).
- Um `429` em modelo pago vem do provider de origem. O OpenRouter tenta outros providers do mesmo modelo antes de devolver o erro, e manda `Retry-After` quando tem.
- Criar outra key não muda nada: a capacidade é global por conta.
- **Orçamento em voo** (`402`, `metadata.reason: "in_flight_budget_exhausted"`): contas pré-pagas com saldo baixo ou sem histórico têm um teto para o custo estimado das requisições abertas. A estimativa usa os tokens de entrada mais `max_tokens`; sem `max_tokens`, usa um teto fixo por requisição. Com `max_tokens: 400` a reserva por chamada é de frações de centavo.

### Esta key e esta conta

- `GET /api/v1/key`: limite da key US$ 50, sem reset, `is_free_tier: false`, expira em 2027-11-11.
- `GET /api/v1/credits`: US$ 5 comprados, US$ 1,01 usados na conta toda. **O saldo real é cerca de US$ 3,99**, bem abaixo do limite da key. Quem para o gasto primeiro é o saldo, não o limite de US$ 50.
- O teto do spec para o OpenRouter é US$ 3; o saldo cobre, com pouca sobra.

### O que foi medido

| Teste | Chamadas | HTTP 200 | 429 / 402 | Válidas | p50 | p95 | Máximo |
|---|---|---|---|---|---|---|---|
| Rajada: 12 simultâneas, 4 ondas, cinco modelos de palco | 48 | 48 | 0 | 48/48 | 1,20 s | 1,83 s | 1,94 s |
| Sustentado: 25 bonecos, um pedido a cada 4 s depois da resposta, teto de 12 abertas, 49 s | 220 | 220 | 0 | 220/220 | 1,16 s | 1,71 s | 2,31 s |

- Vazão sustentada: 4,45 chamadas por segundo. Pico de 10 chamadas abertas; nenhuma esperou na fila de 12.
- Com 12 participants a soma cabe. **Por modelo, não cabe em 2 participants**: com 5 bonecos por modelo, a chamada encontrou 2 ou mais do mesmo modelo em voo em 55% das vezes no Luna, 41% no GLM, 18% no Haiku, 14% no DeepSeek e 4% no MiniMax M3. Os bonecos de um modelo tendem a pedir juntos e a continuar juntos. O agendador precisa esperar um pouco pelo participant do modelo e depois cair em qualquer participant livre, como o spec prevê; mandar para um participant ocupado dá 404 no hub.
- Divisão sugerida dos 12 participants, pela carga medida (latência vezes pedidos): 3 para Luna, 3 para GLM, 2 para Haiku, 2 para DeepSeek, 2 para MiniMax M3.

### Custo de uma dinâmica

Custo médio medido por decisão, na mistura dos cinco modelos de palco: US$ 0,000125 (de 0,000068 no GLM a 0,000202 no Haiku), com cerca de 890 tokens de entrada e 82 de saída.

| Cenário | Chamadas | Custo |
|---|---|---|
| Teto: 25 bonecos decidindo a cada 4 s pelos 8 minutos | 3.000 | US$ 0,38 |
| Provável: fase 1 densa (940), fases 2 e 3 em ritmo mais lento (920), entrevista e resumo (100), propostas de nome e refrão (75), maestro (1) | cerca de 2.040 | US$ 0,27 |
| Mesmo cenário provável com prompt 50% maior (histórico de conversa) | cerca de 2.040 | US$ 0,37 |

- Fica abaixo do teto de US$ 1 por sessão do spec.
- O custo cresce com o tamanho do prompt: 85% dos tokens são de entrada. Histórico curto por boneco mantém o custo e a latência.
- Com cerca de US$ 3,99 de saldo, cabem de 10 a 14 dinâmicas completas, contando ensaios.

## 6. Português: três falas por modelo

Falas devolvidas na bateria final e no teste de carga, copiadas sem edição.

**`anthropic/claude-haiku-5.5`**

1. "Oxente, Dona Sombrinha! Cheguei agora no coreto. Bora batucar um frevo com a senhora?"
2. "Curto demais! Capiba é quase de casa, rapaz. Tu tem qual disco dele aí?"
3. "Gostei das duas! Você prefere um bloco animado ou tranquilo pra gente formar?" Opções: "Animado, bora de frevo!", "Tranquilo, com calma", "Tanto faz, você escolhe".

**`minimax/minimax-m3`** (substituto proposto)

1. "Vou bater lá no coreto, quem sabe tem alguém que curta um café."
2. "Zeca do Trombone chamou pro bloco. Bora fechar com ele?" Opções: "Fecha!", "Espera mais", "Convida outro".
3. "Qual vibe tu quer no bloco, minha professora?" Opções: "Animado pra dançar", "Tranquilo pra curtir", "Mistura dos dois".

**`openai/gpt-6-luna`**

1. "Cuscuz e música? A gente combina, visse! Bora formar esse bloco."
2. "Capiba no vinil? Aí sim! Meu humano coleciona frevo e acorda só quando o lado acaba."
3. "Vou ali pro coreto, visse. Deve ter gente boa por lá."

**`deepseek/deepseek-v4.1-flash-1017`**

1. "Capiba? Oxe, vinil dele é relíquia! Meu humano já acorda sem café, imagina sem frevo."
2. "Sou sim, oxe! Cuscuz com ovo é lei. Bora, mas quero alguém do ritmo junto."
3. "Professora, o bloco vai ser mais animado ou mais tranquilo?" Opções: "Animado, tipo frevo!", "Tranquilo, na manha".

**`z-ai/glm-5.3-flash`**

1. "Ô dia bom pra arrastar o pé... vou ver quem tá no coreto."
2. "Zeca toca trombone e ama cuscuz, ixe! Ele combina contigo?" Opções: "Combina demais!", "Mais ou menos", "Não combina".
3. "Meu humano, tu curte Capiba? Responde aí pro Samuca!" Opções: "Capiba é tudo", "Gosto mais de Nelson Ferreira", "Nunca ouvi Capiba".

**`minimax/minimax-m3.1-flash`** (do spec, com `temperature: 0.3`)

1. "Combina demais, Zeca! Cuscuz com ovo e frevo é a minha cara. Bora fechar o trio!"
2. "Capiba é chique demais, meu Brother! Meu humano tem até o LP raro dele. E tu, curte?"
3. "Ô meu bem, cê prefere maracatu de zabumba ou de agogô pra eu puxar conversa?" Opções: "Maracatu de zabumba", "Maracatu de agogô", "Os dois, ué!".

**`google/gemini-3.5-flash-lite`** (reserva)

1. "Adoro Capiba! Vinil chiando é arte pura, meu velho!"
2. "Eita, Dona Sombrinha! Vumbora curtir esse frevo?"
3. "Tu prefere um bloco animado ou mais sossegado?" Opções: "Animado e festivo", "Mais sossegado".

Leitura: os cinco de palco escrevem português do Brasil natural e com sotaque do Recife (oxe, visse, bora, tu). Haiku e DeepSeek são os mais soltos; Luna é o mais curto; GLM é o que melhor escreve opções para o humano.

## 7. Comportamento, para quem escrever o prompt

Distribuição das ações na bateria final mais a carga (mesmos cinco cenários para todos):

| Modelo | andar | falar | declarar_afinidade | perguntar_humano |
|---|---|---|---|---|
| Haiku 5.5 | 12 | 31 | 0 | 11 |
| MiniMax M3 | 14 | 1 | 3 | 41 |
| GPT-6 Luna | 12 | 10 | 7 | 21 |
| DeepSeek V4.1 Flash | 9 | 28 | 2 | 14 |
| GLM 5.3 Flash | 15 | 0 | 10 | 29 |

- MiniMax M3 e GLM perguntam ao humano quase sempre que podem. A simulação precisa limitar a frequência de perguntas por boneco, senão o celular vira um questionário.
- O Haiku nunca declarou afinidade e o GLM nunca escolheu `falar` nesses cenários. Se a formação de blocos depender dessas ações, o prompt ou a regra da fase precisa puxar.
- Erros além do schema foram raros (2 em 457 com esforço mínimo): uma pergunta ao humano sem `opcoes` (MiniMax M3.1 Flash) e uma afinidade sem `alvo` (GLM). O schema usado deixa `alvo` e `opcoes` opcionais; o servidor deve checar a combinação com a ação.
- Nenhum modelo inventou um boneco ou lugar fora da lista.

## 8. Recomendações para o ticket #18

1. Aplicar o corpo por modelo da seção 2. Guardar como configuração, uma entrada por ID.
2. Trocar `minimax/minimax-m3.1-flash` por `minimax/minimax-m3` e registrar a troca no ticket com o motivo da seção 4.
3. Validar a resposta contra o schema, não só a presença de `tool_calls`. Uma resposta cortada chega com `finish_reason: "tool_calls"` e JSON que faz parse.
4. Contar como inválida a fala com caractere fora do alfabeto latino, e deixar a repetição única do spec cobrir.
5. Sempre enviar `max_tokens`. Não enviar `temperature` para Haiku e Luna.
6. O agendador é quem controla ocupação por participant. Com 2 participants por modelo, o transbordo para outro modelo vai acontecer com frequência; considerar 3 para Luna e GLM.
7. Para o gasto estimado no admin, somar `usage.cost` da resposta do OpenRouter, que já vem em dólares e reflete o provider que atendeu. Calcular por preço de tabela erra nos modelos de peso aberto.

Não verifiquei se o hub do Gambi repassa `reasoning`, `provider` e `tool_choice` até o provider. Os testes foram direto no OpenRouter. No padrão que o lab já usa (`scripts/event-model-fixture.ts`), o participant aponta para um servidor HTTP local; se o hospedeiro de modelos seguir esse padrão, ele pode mesclar o corpo por modelo e pôr o `Authorization` ali, o que independe do que o hub repassa e mantém a key só no hospedeiro.

## 9. Gasto

| Medida | Valor |
|---|---|
| Soma de `usage.cost` das 785 chamadas desta sonda | US$ 0,1050 |
| Uso da key antes (`GET /api/v1/key`, `usage`) | US$ 0,00136 |
| Uso da key logo depois da última chamada (05:16 UTC) | US$ 0,13447 |
| Uso da key alguns minutos depois, sem nenhuma chamada desta sonda | US$ 0,16875 |

**Outro processo está usando a mesma key.** O uso da key continuou subindo (de 0,134 para 0,161 e depois 0,169, este último salto em 20 segundos) com esta sonda parada. Por isso a diferença no uso da key não mede o gasto da sonda; a medida correta é a soma de `usage.cost` das próprias chamadas, US$ 0,105, pouco mais de um quarto do teto de US$ 0,40. Quem for acompanhar o teto de US$ 3 do OpenRouter pela key precisa contar com esse outro consumo.

Das 785 chamadas, 775 devolveram 200, 7 devolveram 400 (testes de desligar raciocínio obrigatório e de `tool_choice` nomeado na Z.AI) e 3 devolveram 404 (endpoint `deepseek` bloqueado pela política de dados da conta). Nenhuma dessas 10 foi cobrada.

## 10. Como repetir

```bash
bun openrouter-probe.ts key                       # uso da key e gasto da sonda
bun openrouter-probe.ts models                    # os cinco do spec no catálogo
bun openrouter-probe.ts run --model z-ai/glm-5.3-flash --recommended --n 10 --concurrency 2 --verbose
bun openrouter-probe.ts run --model z-ai/glm-5.3-flash --label teste --body '{"max_tokens":150}'
bun openrouter-probe.ts burst --concurrency 12 --waves 4
bun openrouter-probe.ts sustain --bonecos 25 --concurrency 12 --interval 4 --duration 45
```

- `--body` recebe JSON mesclado por cima do corpo base (ferramenta forçada pela forma nomeada, `max_tokens: 300`). `null` remove um campo.
- `--recommended` usa a tabela `RECOMMENDED` do script, igual à da seção 2.
- O teto vem de `PROBE_BUDGET_USD` (padrão 0,40) e conta a soma de `usage.cost` em `openrouter-probe-runs.jsonl`. Para zerar a contagem, apague esse arquivo e `openrouter-probe-state.json`.
- O prompt, o schema da ferramenta `decidir` e os cinco cenários estão no topo do script.

Fontes: `GET /api/v1/models`, `GET /api/v1/models/{id}/endpoints`, `GET /api/v1/key`, `GET /api/v1/credits` e as páginas da documentação do OpenRouter sobre Reasoning Tokens, Provider Routing, Limits, Auto Exacto e o guia de migração do Claude 5.5.
