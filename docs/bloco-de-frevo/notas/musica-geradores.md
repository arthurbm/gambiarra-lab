# Música do Bloco de frevo: exploração do fal.ai (2026-11-11)

> Notas de exploração de 2026-11-11, escritas antes ou durante a implementação do Bloco de frevo. Podem estar desatualizadas: o código e `apps/frevo/README.md` valem mais do que elas.

## O que mudou depois

- O que o código faz hoje está em `apps/frevo/src/music/fal.ts` e na seção `music/` de `apps/frevo/README.md`: o refrão vai como letra e é cantado duas vezes quando tem menos de quatro versos, o nome do bloco entra na descrição do pedido, e os limites de 75 s e 30 s foram adotados (`musicTimeoutMs` de 120 s com o fal.ai).
- As três faixas de reserva estão em `apps/frevo-web/public/audio/`. Os caminhos `music/...` desta nota são da pasta da exploração, que não veio para o repositório; os testes dos geradores ficaram na máquina do host (ver `../onde-esta-cada-coisa.md`).

Notas para os tickets #20 (música gerada) e #17 (base embutida). Tudo abaixo foi medido nesta exploração, salvo onde está marcado como "não testado".

## Decisão

- **Gerador principal: `fal-ai/minimax-music/v2.6`.** Cantou o refrão palavra por palavra nas duas gerações cantadas, a 150 BPM, por US$ 0,15, em 36 a 48 s.
- **Gerador de reserva: `fal-ai/elevenlabs/music`** (modo `prompt`). Fica pronto em 9 a 12 s e tem exatamente 30 s, mas trocou as primeiras palavras do refrão nas duas gerações e custa US$ 0,60.
- Isto inverte a ordem da spec (#10 punha o ElevenLabs em primeiro). O motivo é a fidelidade da letra: o refrão aparece no telão enquanto a música toca.
- **A escolha não foi feita por ouvido humano.** Veio de transcrição às cegas por modelos de áudio, medição de andamento e tempos. Os dois juízes de áudio discordaram entre si em vários pontos (ver "Limites"). O host deve ouvir os quatro arquivos em `music/testes/` (dois minutos) antes de fechar.

## Como chamar a API

Os dois IDs existem e respondem. Fila: `POST https://queue.fal.run/<id>` devolve `request_id`, `status_url`, `response_url` e `cancel_url`. O status passa por `IN_QUEUE`, `IN_PROGRESS` e `COMPLETED`. Uma falha também termina em `COMPLETED`; o erro só aparece no `GET` do `response_url`, com o status HTTP do modelo (vi um 504). Autenticação: header `Authorization: Key <key>`.

```ts
// A key vem do ambiente e nunca vai para log.
const FAL_KEY = process.env.FAL_KEY;

async function falQueue(endpoint: string, input: unknown, timeoutMs: number): Promise<string> {
  const headers = { Authorization: `Key ${FAL_KEY}`, "Content-Type": "application/json" };
  const deadline = Date.now() + timeoutMs;
  const submit = await fetch(`https://queue.fal.run/${endpoint}`, {
    method: "POST",
    headers,
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(10_000),
  });
  if (!submit.ok) throw new Error(`fal submit ${submit.status}`);
  const { status_url, response_url, cancel_url } = await submit.json();
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await (await fetch(status_url, { headers })).json();
    if (st.status === "COMPLETED") {
      const res = await fetch(response_url, { headers });
      if (!res.ok) throw new Error(`fal result ${res.status}`); // falha também chega como COMPLETED
      const { audio } = await res.json();
      return audio.url; // MP3 em https://v3b.fal.media/...
    }
  }
  await fetch(cancel_url, { method: "PUT", headers }).catch(() => {});
  throw new Error("fal timeout");
}
```

O fluxo submit, status e result foi o que rodou em todas as gerações (script completo em `music/scripts/gen.mjs`). O `PUT` de cancelamento vem do OpenAPI e **não foi exercitado**. Três pedidos em paralelo e polling de 1 s funcionaram sem limite de taxa.

Saída dos dois: `{ "audio": { "url": "..." } }` (o ElevenLabs também manda `content_type` e `file_name`). A URL do primeiro áudio ainda respondia 200 depois de 40 minutos; a validade não está documentada na página do modelo, então o servidor deve baixar o arquivo e servir a cópia.

### `fal-ai/minimax-music/v2.6` (US$ 0,15 por áudio)

| Campo | Regra |
|---|---|
| `prompt` | obrigatório, 10 a 2000 caracteres: estilo, instrumentos, andamento |
| `lyrics` | até 3500 caracteres, linhas separadas por `\n`, aceita `[Intro]`, `[Chorus]`, `[Outro]`, `[Inst]` etc. Obrigatório quando não é instrumental |
| `is_instrumental` | `true` gera sem voz |
| `lyrics_optimizer` | escreve a letra a partir do prompt quando `lyrics` está vazio |
| `audio_setting` | `sample_rate` (até 44100), `bitrate` (32000 a 256000), `format` (`mp3`, `wav`, `pcm`) |

**Não há parâmetro de duração.** A duração segue a letra: quatro versos uma vez deram 31,6 s; duas vezes, 40,0 s. No modo instrumental saiu de 22 s a 131 s com prompts parecidos. O tempo de geração é quase o da duração do áudio.

### `fal-ai/elevenlabs/music` (US$ 0,60 por minuto, arredondado para cima)

30 s custam o mesmo que 60 s: US$ 0,60.

| Campo | Regra |
|---|---|
| `prompt` | até 4100 caracteres; a letra vai dentro do texto |
| `music_length_ms` | 3000 a 600000, só junto com `prompt` |
| `force_instrumental` | só junto com `prompt` |
| `composition_plan` | alternativa ao `prompt`: `positive_global_styles`, `negative_global_styles` e `sections[]` com `section_name`, `positive_local_styles`, `negative_local_styles`, `duration_ms` (3000 a 120000) e `lines` (letra, até 200 caracteres por linha) |
| `respect_sections_durations` | padrão `true`; só vale com o plano |
| `output_format` | padrão `mp3_44100_128` |

## Resultado do teste dos dois geradores (para colar no #20)

Refrão usado nos dois:

```
Somos três no Recife Antigo
Sombrinha girando no ar
Quem tem frevo tem sempre um amigo
Nosso bloco não vai parar
```

Estilo (igual nos dois): `Frevo-canção from Recife, Pernambuco, Brazilian carnival street brass orchestra. Bright trumpets, trombones, saxophones, tuba marching bass line, snare drum (caixa) rolls and surdo marking a 2/4 march beat. Very fast, about 150 BPM, 2/4 time, major key, euphoric and festive.` mais o pedido de coro misto em português do Brasil. Os JSON exatos estão em `music/prompts/teste-*.json`.

| | MiniMax v2.6 | ElevenLabs, `prompt` | ElevenLabs, `composition_plan` | MiniMax, refrão duas vezes |
|---|---|---|---|---|
| Arquivo em `music/testes/` | `teste-minimax-v2.6.mp3` | `teste-elevenlabs-music.mp3` | `teste-elevenlabs-music-plan.mp3` | `teste-minimax-v2.6-refrao-2x.mp3` |
| Tempo até ficar pronto | 36,1 s | 11,7 s | 9,0 s | 47,6 s |
| Duração real (`ffprobe`) | 31,58 s | 30,04 s | 30,04 s | 40,02 s |
| Custo | US$ 0,15 | US$ 0,60 | US$ 0,60 | US$ 0,15 |
| Andamento medido | 150 BPM | 150 BPM | 150 BPM | 150 BPM |
| Voz entra em | 11 a 12 s | 12 a 14 s | 5 a 7 s | 12 a 14 s |
| Primeiro verso, transcrito às cegas | "Somos três no Recife Antigo" nas 3 transcrições | "Somos do Recife antigo", "Sob o céu do Recife Antigo", "Somos seres do Recife" | "Somos dez…", "Sol nos pés…", "Somos três…" | exato nas 2 transcrições |
| Resto da letra | exato nos 2 juízes Gemini | um juiz ouviu "Quem tem frevo no pé, meu amigo" no 3º verso | exato, cantado duas vezes | exato, cantado duas vezes |
| Final | limpo | limpo, acorde final perto de 27 s | cortado no meio de "parar" | limpo |
| Gênero apontado às cegas | frevo-canção, segundo palpite marchinha | frevo-canção, segundo palpite marchinha | frevo-canção; um juiz ouviu mistura com salsa e merengue, piano e congas | frevo-canção, segundo palpite marchinha |
| Pronúncia | um juiz deu 10/10; o outro 7/10 e apontou "Recife" e "frevo" com sotaque estranho | 9 a 10/10 | 9 a 10/10 | igual ao primeiro |

Leitura:

- Os dois cantam em português e saem a 150 BPM em 2/4. "Soa como frevo" ficou em "frevo-canção ou marchinha" para ambos; nenhum juiz chamou de frevo de rua autêntico.
- O MiniMax cantou a letra certa. O ElevenLabs trocou o começo do primeiro verso nas duas gerações; o "três" não saiu claro em nenhuma.
- O `composition_plan` adianta a voz e repete o refrão, mas com seções de 5 s, 13 s e 12 s cortou a última palavra. Aumentar as seções não foi testado.
- Confiabilidade: 8 de 9 gerações do MiniMax deram certo. A que falhou ficou 362 s em `IN_PROGRESS` e devolveu 504 `downstream_service_unavailable` (era instrumental). As 2 do ElevenLabs deram certo.

## Prompt escolhido

Principal, `fal-ai/minimax-music/v2.6` (36 s até ficar pronto, 31,6 s de áudio, US$ 0,15):

```json
{
  "prompt": "Frevo-canção from Recife, Pernambuco, Brazilian carnival street brass orchestra. Bright trumpets, trombones, saxophones, tuba marching bass line, snare drum (caixa) rolls and surdo marking a 2/4 march beat. Very fast, about 150 BPM, 2/4 time, major key, euphoric and festive. Joyful mixed choir singing the chorus in Brazilian Portuguese. Short song, about 30 seconds.",
  "lyrics": "[Intro]\n[Chorus]\n<verso 1>\n<verso 2>\n<verso 3>\n<verso 4>\n[Outro]",
  "audio_setting": { "sample_rate": 44100, "bitrate": 128000, "format": "mp3" }
}
```

Reserva, `fal-ai/elevenlabs/music` (12 s até ficar pronto, 30,0 s de áudio, US$ 0,60):

```json
{
  "prompt": "Frevo-canção from Recife, Pernambuco, Brazilian carnival street brass orchestra. Bright trumpets, trombones, saxophones, tuba marching bass line, snare drum (caixa) rolls and surdo marking a 2/4 march beat. Very fast, about 150 BPM, 2/4 time, major key, euphoric and festive. After a short brass intro, a joyful mixed choir sings this chorus in Brazilian Portuguese, exactly as written:\n\n<verso 1>\n<verso 2>\n<verso 3>\n<verso 4>",
  "music_length_ms": 30000,
  "force_instrumental": false,
  "output_format": "mp3_44100_128"
}
```

Não testado:

- Refrão de dois ou três versos (a spec permite de dois a quatro). No MiniMax a duração cai junto com a letra; repetir o bloco `[Chorus]` deve compensar (com quatro versos repetidos deu 40 s).
- Nome do bloco no prompt. Só o refrão foi enviado.
- Refrão escrito por modelo, com palavras menos comuns.

## Tempo limite recomendado

| Passo | Tempo observado | Limite |
|---|---|---|
| MiniMax | 34 a 48 s (3 gerações cantadas) | 75 s |
| ElevenLabs, se o MiniMax falhar ou estourar | 9 a 12 s (2 gerações) | 30 s |
| Faixa de reserva embutida | imediato | |

Pior caso: 105 s, dentro dos 3 minutos do desfile. Sem limite, a falha que vi seguraria o pedido por 6 minutos. Cada bloco que cai no ElevenLabs gasta duas gerações; com três blocos, o pior caso é 3 × (0,15 + 0,60) = US$ 2,25 e as seis gerações da sessão.

## Faixas de reserva

Todas MP3 estéreo, 44,1 kHz, 128 kbps, volume igualado perto de −14 LUFS.

| Arquivo | Origem | Duração | Tamanho | Andamento medido | O que é |
|---|---|---|---|---|---|
| `music/reserva-1.mp3` | MiniMax instrumental, primeiros 30 s | 30,0 s | 481 kB | perto de 136 BPM | Só instrumental. Dos 12 aos 24 s fica um trompete sozinho, sem a banda (confirmado por medição de energia). O juiz crítico deu 4/10 e achou parecido com fanfarra dos Bálcãs |
| `music/reserva-2.mp3` | MiniMax, modo cantado com letra "lá lá lá" | 30,5 s | 489 kB | 150 BPM | Orquestra completa do início ao fim, coro sem palavras dos 8 aos 26 s, final limpo. A mais bem avaliada: 7/10 em frevo, 6/10 em realismo |
| `music/reserva-3.mp3` | MiniMax instrumental, faixa inteira | 21,9 s | 350 kB | 159 BPM | Fanfarra curta com introdução de caixa e acorde final. 6/10 em frevo, mas os metais soam sintéticos. **Tem 22 s, não 30** |

**Para o #17:** a melhor base é a `reserva-2.mp3`. Ela não é estritamente instrumental, mas o coro não tem palavras e não disputa com o refrão na tela. Mantive a `reserva-1.mp3` como a instrumental pedida e não a troquei depois de entregue.

O modo instrumental do MiniMax foi fraco para frevo: em cinco faixas, três saíram entre 120 e 136 BPM, apesar do pedido de 150, e o juiz crítico descreveu quatro delas como som de teclado MIDI. O modo cantado segurou 150 BPM em todas. Cortes de 30 s das faixas não usadas estão em `music/testes/alternativas/` e os áudios inteiros em `music/testes/brutos/`.

Os testes cantados do MiniMax também servem de reserva, se o host aceitar um refrão genérico cantado ("Somos três no Recife Antigo…").

## Tempos e custos por geração

| # | Modelo | O quê | Tempo até pronto | Áudio | Custo |
|---|---|---|---|---|---|
| 1 | MiniMax | instrumental (`reserva-1`) | 126,3 s | 131,2 s | 0,15 |
| 2 | ElevenLabs | teste cantado, `prompt` | 11,7 s | 30,0 s | 0,60 |
| 3 | MiniMax | teste cantado | 36,1 s | 31,6 s | 0,15 |
| 4 | ElevenLabs | teste cantado, `composition_plan` | 9,0 s | 30,0 s | 0,60 |
| 5 | MiniMax | instrumental "ventania" | 97,8 s | 96,3 s | 0,15 |
| 6 | MiniMax | instrumental "abafo" | 362,1 s | falhou, 504 | 0,00 |
| 7 | MiniMax | instrumental "abafo", de novo (`reserva-3`) | 35,5 s | 22,0 s | 0,15 |
| 8 | MiniMax | teste cantado, refrão duas vezes | 47,6 s | 40,0 s | 0,15 |
| 9 | MiniMax | instrumental "abafo", outro prompt | 103,2 s | 110,8 s | 0,15 |
| 10 | MiniMax | instrumental "chamada e resposta" | 103,7 s | 111,9 s | 0,15 |
| 11 | MiniMax | coro "lá lá lá" (`reserva-2`) | 34,1 s | 30,9 s | 0,15 |

**Gasto no fal.ai: US$ 2,40** (teto de 2,50). A conta supõe que a geração 6 não foi cobrada: a doc de confiabilidade do fal diz que pedidos que terminam em 5xx não são faturados. A key não tem permissão para ler o faturamento, então não confirmei. Se a falha tiver sido cobrada, o total é US$ 2,55, cinco centavos acima do teto.

**Gasto no OpenRouter: US$ 0,12** (teto de 0,15), em 23 chamadas de avaliação de áudio.

Preços confirmados em `https://api.fal.ai/v1/models/pricing`: ElevenLabs 0,60 por minuto, MiniMax 0,15 por áudio.

## Limites da avaliação

- Ninguém ouviu os áudios. Os juízes foram `google/gemini-3.8-flash`, `google/gemini-4-argon` e, numa pergunta, `openai/gpt-audio-mini`.
- O `gemini-3.8-flash` não é confiável para julgar estilo: deu 10/10 de "frevo de livro" a uma faixa em que o `gemini-4-argon` ouviu um solo de trompete de 13 s. A medição de energia confirmou o solo (graves caem de −17 dB para −55 dB entre 12 e 24 s). Por isso as notas de estilo acima são as do `gemini-4-argon`.
- A transcrição da letra é a evidência mais forte: os juízes não receberam o texto e devolveram o refrão. O `gpt-audio-mini` errou palavras até na faixa em que os outros dois acertaram tudo, então pesa menos.
- Uma amostra por configuração. Tempos e fidelidade podem variar.
- O andamento foi medido por autocorrelação do envelope de ataques (`music/scripts/bpm.mjs`), sem depender de modelo.

## Arquivos

Na pasta da exploração (fora do repositório):

- `music.md`: esta nota
- `music/reserva-1.mp3`, `music/reserva-2.mp3`, `music/reserva-3.mp3`: faixas de reserva
- `music/testes/`: os quatro testes cantados
- `music/testes/alternativas/`: quatro cortes instrumentais de 30 s não escolhidos
- `music/testes/brutos/`: as seis faixas do MiniMax inteiras, como vieram
- `music/prompts/`: o JSON de entrada de cada geração. Os nomes seguem a ordem das tentativas, não a dos arquivos finais: `reserva-1.mp3` veio de `reserva-1.json`, `reserva-2.mp3` de `reserva-lala.json` e `reserva-3.mp3` de `reserva-2.json`
- `music/scripts/`: `gen.mjs` (fila do fal.ai), `listen.mjs` (juiz de áudio), `bpm.mjs`, `energy.mjs`
