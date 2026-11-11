# Arte do Bloco de frevo: notas de exploração

> Notas de exploração de 2026-11-11, escritas antes ou durante a implementação do Bloco de frevo. Podem estar desatualizadas: o código e `apps/frevo/README.md` valem mais do que elas.

## O que mudou depois

- Os arquivos escolhidos estão em `apps/frevo-web/public/art/` (personagens, retratos, tiles, UI e a licença do pacote). Os ícones dos instrumentos viraram `apps/frevo-web/src/art/instrument-icons.ts`.
- Escala inteira, perseguição do alvo e balões em DOM foram implementados; tamanho do mundo, escala e limite de balões valem os de `apps/frevo-web/src/telao/` e da seção "Art" de `apps/frevo/README.md`.

Notas para o ticket #19 (spec #10, seção "Arte"). Levantadas em 2026-11-11. Nada foi editado no repositório.

Os caminhos `art/...` abaixo são da pasta da exploração, que não veio para o repositório.

| O quê | Onde | Tamanho |
|---|---|---|
| Arquivos escolhidos, prontos para copiar para o repo | `art/selected/` (82 arquivos) | 491 KB |
| Índice dos escolhidos | `art/selected/manifest.json` | 56 KB (já contado acima) |
| Rascunhos meus (praça montada, ícones de frevo, scripts) | `art/draft/` | 127 KB |
| Zip original e extração completa (não vai para o repo) | `art/download/` | 204 MB |

O que foi conferido e o que não foi:

- Conferido por script: tamanho e layout das spritesheets, igualdade pixel a pixel entre `SpriteSheet.png` e os arquivos de `SeparateAnim/`, duplicatas entre personagens, e que toda região do manifest cai dentro da imagem e não está vazia.
- Conferido a olho, em imagem gerada com PIL: os 30 personagens, os tiles e a praça montada.
- **Não** conferido: nada foi rodado num navegador. A recomendação de renderização (seção 7) é raciocínio de projeto, não medição.

---

## 1. Fonte e licença do pacote

**Pacote:** Ninja Adventure - Asset Pack, de Pixel-Boy e AAA.

**Página que declara o CC0:** <https://pixel-boy.itch.io/ninja-adventure-asset-pack> (consultada em 2026-11-11).

Frase exata no corpo da página:

> They are released under the Creative Commons Zero (CC0) license.

Parágrafo seguinte, também literal:

> You can use any and all of the assets found in this package in your own games, even commercial ones. Attribution is not required but appreciated. Placing a link to this itchio page somewhere would be awesome :)

Na tabela "More information" da mesma página, o campo de metadados diz: **Asset license: Creative Commons Zero v1.0 Universal** (link para <https://itch.io/game-assets/assets-cc0>). A assinatura da página é "Made by Pixel-Boy and AAA".

**Dentro do zip** há confirmação independente da página:

- `LICENSE.txt`: texto integral do CC0 1.0 Universal.
- `README.md`: "Assets created by: Pixel-boy, AAA", a mesma frase do CC0 e o pedido de link para `https://pixel-boy.itch.io/ninja-adventure-asset-pack`.

Copiei os dois para `art/selected/NINJA-ADVENTURE-LICENSE.txt` e `art/selected/NINJA-ADVENTURE-README.md`. Vale levá-los junto com os PNGs para o repo.

**Repositório do autor no GitHub:** <https://github.com/pixel-boy/NinjaAdventure>. A API do GitHub devolve `license: null` e a árvore não tem arquivo de licença. Além disso, ele **não serve como fonte**: é só o projeto Godot 4 de exemplo, com quatro personagens (`ninja_blue`, `pig`, `samurai_blue`, `samurai_green`). O pacote completo só existe no itch.io.

### Download sem login

O zip do itch.io baixa sem conta ("Name your own price", preço mínimo zero). O link final é assinado e expira, então o caminho reprodutível são três pedidos:

```bash
B=https://pixel-boy.itch.io/ninja-adventure-asset-pack
UA="Mozilla/5.0 (X11; Linux x86_64)"
# 1. página do pacote: pega o cookie e o csrf_token
curl -sS -A "$UA" -c jar -b jar -o page.html "$B"
# 2. POST $B/download_url com csrf_token  -> JSON {"url": ".../download/<chave>"}
# 3. GET nessa url: a página lista os uploads (data-upload_id) e traz um csrf_token novo
# 4. POST "$B/file/<upload_id>?source=game_download&as_props=1&after_download_lightbox=true"
#    com csrf_token e Referer da página do passo 3 -> JSON {"url": "<link temporário do zip>"}
```

Em 2026-11-11 os uploads eram:

| upload_id | Arquivo | Tamanho | Data |
|---|---|---|---|
| 16981275 | `Ninja Adventure - Asset Pack.zip` | 89 MB | 2026-03-29 (Update #8) |
| 10222874 | `Godot Project V4.zip` | 30 MB | 2024-04-19 |
| 3772171 | `Godot project V3 (old).zip` | 8,5 MB | 2021-05-03 |

Baixei só o primeiro:

- `art/download/ninja-adventure-asset-pack.zip`, 94.022.790 bytes
- SHA-256 `95a06f4fdcfd1882f061a45ff313b7c905dbe2de1e8512b281d7937df62a7b15`
- 2.674 entradas: 1.915 PNG, 147 WAV, 128 GIF, 41 OGG, 1 TTF, 1 TXT, 1 MD. Nenhum executável, nenhum caminho absoluto ou com `..`.
- Extraído em `art/download/extracted/Ninja Adventure - Asset Pack/`. Nada de dentro dele foi executado.

---

## 2. Layout das spritesheets de personagem

Pasta de cada personagem: `Actor/Character/<Nome>/`.

| Arquivo | Tamanho | Conteúdo |
|---|---|---|
| `SeparateAnim/Walk.png` | 64x64 | **o "walk"**: 4 colunas x 4 linhas de quadros 16x16 |
| `SeparateAnim/Idle.png` | 64x16 | 1 quadro por direção; idêntico à linha 0 do Walk |
| `SpriteSheet.png` | 64x112 | tudo junto, 7 linhas de 16 px (tabela abaixo) |
| `Faceset.png` | 38x38 | retrato, bom para o celular |
| `SeparateAnim/{Attack,Jump}.png` | 64x16 | 1 quadro por direção |
| `SeparateAnim/{Dead,Item,Special1,Special2}.png` | 16x16 | quadros únicos |

**Quadro:** 16x16 px.

**Direções: são as colunas.** Coluna 0 = baixo (de frente), 1 = cima (de costas), 2 = esquerda, 3 = direita.

**Quadros de andar: são as linhas.** Linhas 0 a 3, quatro quadros por direção. O quadro `i` da direção `d` está em `sx = d * 16`, `sy = i * 16`. A linha 0 é a pose parada.

`SpriteSheet.png` (64x112), que é o arquivo que copiei para `selected/characters/`:

| Linha | Conteúdo | Colunas |
|---|---|---|
| 0-3 | andar (igual ao `Walk.png`) | direção |
| 4 | ataque | direção |
| 5 | pulo | direção |
| 6 | morto, **item**, special1, special2 | 0, 1, 2, 3 |

Escolhi a spritesheet completa em vez do `Walk.png` porque as linhas 0-3 são as mesmas e ela traz de graça duas poses úteis para o frevo: o **pulo** (linha 5, serve de passo) e o **item** (linha 6, coluna 1: boneco de frente com os braços erguidos, serve para levantar a sombrinha ou o instrumento no desfile).

Detalhes verificados:

- Dos 95 personagens do pacote, 93 têm `Walk.png` de 64x64. `Child` e `OldWoman` só têm uma folha de 64x32 e ficaram de fora.
- Em 65 dos 90 comparados, esquerda é o espelho exato da direita; em 25 não é (detalhe assimétrico). Use sempre as colunas 2 e 3 do arquivo, sem espelhar por código.
- Em vários, o quadro 0 é igual ao 2 (ciclo parado, passo, parado, outro passo). Tocar as quatro linhas em sequência a 8 quadros por segundo funciona para todos.
- `Villager5` e `Villager6` são o mesmo desenho. `Village6` (sem "r") é outro personagem, o urso.
- `Actor/Character/Shadow.png` (12x7) é a sombra para pôr embaixo do boneco.
- **Os bichos de `Actor/Animal/` não servem**: têm só 2 quadros de 16x16 numa direção. Os "animais" abaixo são personagens antropomórficos de `Actor/Character/`, com o mesmo layout dos outros.

---

## 3. Os 30 personagens

Em `art/selected/characters/<id>.png` (64x112) e `art/selected/faces/<id>.png` (38x38). Cópias byte a byte dos originais.

Imagem com os 30 lado a lado: `art/draft/characters-lineup.png`.

| id | Pasta no pacote | Como reconhecer |
|---|---|---|
| villager-01 | Villager | careca, pele laranja, camisa azul |
| villager-02 | Villager2 | cabelo preto cacheado, pele vermelho-escura |
| villager-03 | Villager3 | cabelo castanho-escuro arredondado, pele marrom, camisa verde |
| villager-04 | Villager4 | cabelo loiro liso, camisa vermelha |
| villager-05 | Villager5 | coque preto com laço verde, rosto vermelho |
| villager-06 | Woman | cabelo loiro comprido com faixa azul |
| villager-07 | Princess | cabelo preto comprido com laço vermelho e amarelo, vestido amarelo |
| villager-08 | SorcererBlack | marias-chiquinhas vermelhas, roupa escura |
| villager-09 | SorcererOrange | marias-chiquinhas verde-escuras, roupa laranja |
| villager-10 | OldMan2 | gorro vermelho, barba branca |
| villager-11 | OldMan3 | chapéu de palha amarelo em cone, barba branca |
| villager-12 | Master | cabelo e barba brancos, roupa vermelha |
| villager-13 | Noble | chapéu preto de aba larga |
| villager-14 | Inspector | chapéu branco com faixa marrom |
| villager-15 | Boy | cabelo vermelho espetado |
| ninja-01 | NinjaBlue | capuz azul-claro com faixa branca |
| ninja-02 | NinjaGreen | capuz verde-oliva |
| ninja-03 | NinjaRed2 | capuz vermelho com laço |
| ninja-04 | NinjaYellow | capuz amarelo com laço vermelho |
| ninja-05 | NinjaGray | capuz cinza com faixa branca |
| ninja-06 | NinjaDark | capuz cinza-escuro, olhos vermelhos |
| ninja-07 | NinjaMageOrange | chapéu pontudo escuro, roupa laranja |
| animal-01 | Pig | porco rosa |
| animal-02 | MaskFrog | sapo verde |
| animal-03 | MaskRacoon | guaxinim vermelho de máscara |
| animal-04 | MonkeyBoxerBlue | macaco marrom de topete azul |
| animal-05 | Lion | leão de juba ruiva |
| animal-06 | LionOrange | leão de juba preta |
| animal-07 | Village6 | urso amarelo de chapéu vermelho |
| animal-08 | NinjaThunder | cachorro amarelo com mancha branca na testa |

São 15 moradores, 7 ninjas e 8 animais. O critério foi silhueta e cor dominante diferentes dentro de cada grupo.

**Reservas** (genéricos, não copiados): `Monk`, `OldMan`, `Samurai` (chapéu de palha enorme), `SamuraiBlue`, `EggGirl`, `Shaman`, `Cavegirl2`, `MaskGoldRacoon`, `NinjaBomb`, `NinjaMageBlack`, `NinjaBlue2`.

**Deixados de fora por lembrarem personagem de outro jogo ou marca** (julgamento meu, de olho; ninguém conferiu marca registrada):

- `FighterWhite` e `FighterRed`: lutadores de faixa na testa e quimono, com cara de jogo de luta conhecido.
- `CamouflageRed` e `CamouflageGreen`: chapéu de cogumelo.
- `ManGreen`: gorro verde pontudo.
- `Monk2`: monge careca com pontos na testa.
- `NinjaMasked`: máscara branca de bicho.
- `GreenPig`: porco verde.
- `RedNinja3`: armadura vermelha e dourada.
- `Hunter`: faixa vermelha na testa.

Também fora, por não serem moradores, ninjas nem animais: demônios, esqueletos, vampiro, estátuas, robôs, cavaleiros, gladiadores, `Spirit`, `Flam`, sultões e tengus. `Eskimo` e `NinjaEskimo` ficaram de fora pelo nome datado e por serem quase iguais entre si.

Ponto de atenção visual: sobre o piso amarelo da praça, os três mais claros (`villager-04`, `animal-07`, `animal-08`) têm menos contraste de cor. O contorno escuro de 1 px segura a leitura, mas a sombra embaixo e o nome no balão ajudam.

---

## 4. Tiles da praça

Tiles de 16x16. Copiei os tilesets inteiros (são pequenos) e nomeei as regiões no `manifest.json`, em unidades de tile: `{col, row, w, h}`.

| Arquivo em `selected/tiles/` | Origem (`Backgrounds/Tilesets/`) | Tamanho |
|---|---|---|
| `floor.png` | `TilesetFloor.png` | 352x417, 30 KB |
| `paving.png` | `Interior/TilesetInteriorFloor.png` | 352x272, 13 KB |
| `nature.png` | `TilesetNature.png` | 384x336, 43 KB |
| `house.png` | `TilesetHouse.png` | 528x368, 58 KB |
| `water.png` | `TilesetWater.png` | 448x272, 24 KB |
| `desert.png` | `TilesetDesert.png` | 320x192, 19 KB |
| `flag-{red,yellow,blue,green}.png` | `../Animated/Flag/Flag*16x16.png` | 64x16 cada, 4 quadros |

Regiões principais (todas no manifest):

| Uso | Arquivo | Região (col, row, w, h) |
|---|---|---|
| Grama lisa | `floor.png` | `grass` (0,12,1,1) |
| Grama com detalhe | `floor.png` | `grass-detail-1..4` (1..4,12) |
| Terra batida com borda de grama (9 pedaços) | `floor.png` | (0..2, 7..9), centro `dirt` (1,8) |
| Grama escura (alternativa) | `floor.png` | `grass-dark` (11,12), detalhes (12..15,12) |
| **Calçada de pedra** (9 pedaços com moldura) | `paving.png` | `cobble-nw` (0,12) até `cobble-se` (2,14), centro `cobble` (1,13) |
| **Medalhão central** | `paving.png` | `medallion` (15,0,4,4) |
| Árvores pequenas 2x2 | `nature.png` | `tree-round` (0,0), `tree-pine` (2,0), `tree-pink` (14,0), `tree-green` (16,0) |
| Árvores grandes 3x3 | `nature.png` | `bigtree-pink` (0,18), `bigtree-green` (3,18), `bigtree-white` (6,18), `bigtree-peach` (9,18) |
| Arbustos e flores 1x1 | `nature.png` | `bush-1..3` (0..2,10), `sunflower-1..2` (0..1,11), `flower-red` (3,11), `flower-white` (6,11) |
| Casas 4x3 | `house.png` | `house-orange` (0,0), `house-beige` (4,0), `house-red` (12,0), `shop-green` (19,0) |
| Casas 3x3 | `house.png` | `shop-blue` (16,0), `house-round` (23,0), `house-wood` (26,0) |
| Estandartes coloridos 1x2 | `house.png` | `banner-1..7` (22..28, 20) |
| Barracas de feira 3x2 | `house.png` | `stall-1` (16,16), `stall-2` (19,16) |
| Laguinho 3x3 com borda de grama | `water.png` | `pond` (0,6,3,3) |
| **Fonte**: bacia de pedra com água, 2x2 | `desert.png` | `fountain-basin` (8,7,2,2) |
| Fonte de parede: cabeça de leão com água, 2x3 | `desert.png` | `fountain-lion` (0,6,2,3) |
| Poço redondo de pedra, 2x2 | `desert.png` | `well-round` (0,3,2,2) |
| Coqueiros 2x2 | `desert.png` | `palm-1` (10,10), `palm-2` (12,10) |
| Grupos de três coqueiros 4x3 | `desert.png` | `palm-cluster-1` (10,4), `palm-cluster-2` (10,7) |
| Barracas de toldo colorido 2x2 | `desert.png` | `stall-red-blue` (2,10), `stall-yellow` (4,10), `stall-blue-cloth` (6,7), `stall-green-cloth` (6,9) |

Observações:

- **Fonte existe, coreto não.** A fonte está no tileset de deserto: uma bacia de pedra com água (`fountain-basin`, 2x2) e uma cabeça de leão que verte água (`fountain-lion`, 2x3). Não achei coreto em nenhum tileset de `Backgrounds/Tilesets/`; os únicos que não abri são os de interior de casa (`Interior/TilesetInterior`, `Interior/Elements`, `Interior/TilesetWallSimple`, `tileset_bed`).
- Para o centro da praça, a combinação que ficou melhor no rascunho é a bacia em cima do **medalhão** de 4x4 tiles (o medalhão lembra a rosa dos ventos do Marco Zero, o que casa com o tema). O laguinho 3x3 é a alternativa.
- O tileset de deserto também tem **coqueiros** e **barracas de toldo colorido**, que dão cara de Recife e de festa de rua.
- A borda do laguinho usa a grama clara (`#adbc3a`), a mesma de `grass`. Por isso a grama base recomendada é a clara, não a `grass-dark`.
- Os estandartes e as bandeirinhas animadas dão o ar de carnaval sem desenhar nada novo.
- `TilesetHouse` tem também um portal torii e uma placa "DOJO". Deixei sem nome no manifest, de propósito.

### Rascunho de praça

Montei uma praça de 24x16 tiles (384x256 px) só com as regiões acima, para provar que os tiles combinam:

- `art/draft/plaza-draft-384x256.png`: o mapa em tamanho nativo.
- `art/draft/plaza-preview-1536x1024.png`: o mesmo em escala 4, com os 30 bonecos espalhados, como ficaria num telão 1080p.
- `art/draft/plaza.py`: o script que monta (lê `selected/manifest.json`).

Composição: grama em tudo, calçada de pedra nas colunas 3 a 20 e linhas 4 a 13 (18x10 tiles de área de andar), medalhão com a bacia da fonte no centro, cinco casas na borda de cima, árvores, coqueiros e duas barracas nas laterais, flores embaixo, quatro estandartes na entrada da calçada.

No rascunho os bonecos foram espalhados ao acaso e alguns pisam na fonte. Na experiência a fonte (2x2 tiles no centro) precisa ser obstáculo na simulação, ou então ficar de fora.

É rascunho. O mapa de verdade depende das coordenadas da simulação (#11), que não li. A forma mais barata de usar é pré-renderizar o fundo uma vez (em build ou num canvas fora da tela) e desenhar por cima só bonecos e enfeites animados.

---

## 5. Figurino de frevo

**O pacote não tem nenhum dos oito itens** (trompete, trombone, saxofone, tuba, surdo, caixa, pandeiro, sombrinha). Procurei por nome de arquivo no pacote inteiro e olhei `Items/`. O único instrumento musical é `Items/Object/PanFlute.png` (flauta de pã, 16x16), copiado em `selected/props/pan-flute.png` só como referência de traço.

O caminho é desenhar ícones 16x16 por código. Já deixei um rascunho dos oito:

- `art/draft/frevo-icons/{trompete,trombone,saxofone,tuba,surdo,caixa,pandeiro,sombrinha}.png`
- `art/draft/frevo-icons/frevo-icons.json`: as mesmas grades como texto (16 linhas de 16 caracteres por ícone, mais a paleta). Dá para colar num módulo TypeScript e pintar com `fillRect` num canvas fora da tela, sem nenhum arquivo de imagem.
- `art/draft/frevo_icons.py`: o gerador.

São desenhos originais meus, não vêm do pacote. Usei as cores do próprio pacote para combinarem: contorno `#141b1b`, dourado `#f1c471`, sombra `#d78b4a`, vermelho `#d14b34`, branco `#e3f1f5`, cinza `#9ba7aa`. Os oito são reconhecíveis em escala 3; o pandeiro é o mais fraco (as platinelas quase somem) e merece um retoque.

Como usar no boneco:

- **Andando:** ícone ao lado, deslocado uns +9 px em x e +3 px em y do boneco, subindo e descendo 1 px junto com o quadro de andar. Desenhe depois do boneco quando ele olha para baixo ou para os lados, e antes quando olha para cima.
- **No desfile:** pose `item` (linha 6, coluna 1) com o ícone 10 px acima da cabeça. A sombrinha fica especialmente bem.
- **No celular:** retrato 38x38 ampliado, com o ícone 16x16 ao lado e o nome do instrumento.

Alternativa sem desenhar: emoji (🎺 🎷 🥁 ☂️) num selo ao lado do nome. Não cobre trombone, tuba, surdo nem pandeiro, e quebra o estilo.

---

## 6. O World do Calegario (só inspiração)

Lido pela API do GitHub em 2026-11-11, commit `db3f113`. Nada foi clonado nem copiado.

- Repositório: <https://github.com/gambiarraclub/gambiarra-arena>
- Licença: MIT, "Copyright (c) 2025 Gambiarra LLM Club"
- Autor do modo World: Filipe Calegario (`filipecalegario`), commit "feat: add 2D agent world mode (perceive→decide→act arena)", 2026-05-22
- Arquivos: `telao/src/components/WorldArena.tsx` (455 linhas) e `server/src/core/world.ts` (623 linhas)

### Como ele faz

- **Pilha:** React 18, Vite e Tailwind. Nenhuma biblioteca de jogo. Um `<canvas>` 2D em tela cheia, com título, objetivo e placar em DOM por cima.
- **Transporte:** WebSocket. O servidor simula e transmite a 20 Hz (`SIM_INTERVAL_MS = 50`) o estado **completo**: cada agente com `id`, `nickname`, `emoji`, `color`, `x`, `y`, `heading`, `score`, `say`, `radarAt`, `bumpedAt`. Mundo lógico de 1600x900.
- **Interpolação:** guarda o snapshot anterior e o atual em refs, mais a hora local de chegada. A cada quadro, `alpha = (agora - chegada) / intervalo` (intervalo estimado, preso entre 30 e 200 ms) e interpola linearmente por `id`.
- **Movimento:** o agente fica **parado** e dá um salto discreto por decisão do modelo (480 ms, com aceleração e freio calculados no servidor). O comentário do código resume: uma decisão, um salto visível, para a relação "o modelo decidiu, o boneco andou" ficar legível.
- **Sprites:** não há. Cada agente é um círculo neon com um emoji, uma linha indicando a direção e nome e pontos embaixo.
- **Efeitos:** anel de radar quando o agente percebe o mundo (700 ms) e tremida com faíscas ao bater na parede (450 ms). Os dois são disparados quando o cliente vê o carimbo mudar e contados pelo relógio local, o que os torna imunes a diferença de relógio com o servidor.
- **Balões:** desenhados no canvas, uma linha, fonte de 13 px, retângulo arredondado com borda na cor do agente, 52 px acima. O servidor corta a fala em 60 caracteres e a expira em 4 s. Não trata sobreposição.
- **Escala:** `min(larguraCss / W, alturaCss / H) * 0.95`, centralizado, com o canvas redimensionado por `devicePixelRatio`. Não é escala inteira, o que não importa para círculos.
- **React fora do caminho quente:** snapshots em refs, um único laço de `requestAnimationFrame`, e o estado React do placar atualizado no máximo a cada 250 ms.
- **Conexão:** reconexão com espera exponencial até 10 s e faixa "DESCONECTADO" na tela.

### Ideias que valem a pena

1. **Uma decisão, um movimento visível**, com um sinal de "pensando" enquanto o modelo responde. No frevo: o balãozinho de três pontos (`selected/ui/thinking.png`) sobre o boneco com pedido pendente. É o que mostra à plateia que há um modelo decidindo.
2. **Refs e um laço de animação só**, com o React atualizando painel e lista em baixa frequência.
3. **Efeitos contados pelo relógio local** a partir do momento em que o cliente vê o evento.
4. **Snapshot completo a cada envio.** Uma reconexão se conserta sozinha.
5. **Fala com validade e corte no servidor.**
6. **Faixa de desconectado** no telão.

### O que não aproveitar

- Escala fracionária: borra ou serrilha pixel art.
- Balão de 13 px no canvas: ilegível num projetor.
- 20 Hz: desnecessário por SSE; a seção 7 resolve com 4 ou 5 por segundo.
- Ordem de desenho sem ordenar por `y`: com sprites, quem está mais abaixo precisa cobrir quem está acima.

---

## 7. Recomendação de renderização (React + Vite)

**Resumo:** canvas 2D com escala inteira para o mundo, DOM por cima para balões e painel, e sprite por CSS no celular.

### Por que canvas para o mundo

- São cerca de 100 `drawImage` por quadro (fundo, 30 sombras, 30 bonecos, 30 figurinos). É trivial para canvas 2D.
- Ordenar por `y`, arredondar posição para pixel inteiro e trocar de quadro ficam num lugar só, fora do React.
- Com DOM e `image-rendering: pixelated` também daria para 30 bonecos, mas cada um vira um elemento com `transform` e `background-position` atualizados a 60 Hz, e a ordem por `y` vira `z-index`. Mais peças móveis para o mesmo resultado.

### Escala e nitidez

- Mundo nativo de **384x256 px** (24x16 tiles). Em 1920x1080, escala **4** dá 1536x1024: sobram exatamente 384 px de largura para o painel dos modelos e 56 px de altura para uma faixa de fase e relógio. Boneco com 64 px na tela.
- Escala sempre inteira: `S = max(1, floor(min(largDisp / 384, altDisp / 256)))`, medida em pixels físicos (`css * devicePixelRatio`). O que sobra vira painel e faixa, nunca escala fracionária. Num projetor 1280x720 dá `S = 2` (768x512) e o painel fica mais largo.
- Canvas com `width = 384 * S` e `height = 256 * S` no armazenamento interno, e `style.width = (384 * S / dpr) px`.
- `ctx.imageSmoothingEnabled = false`, **reaplicado depois de cada mudança de `canvas.width`** (redimensionar zera o estado do contexto). CSS `image-rendering: pixelated` no canvas como segunda garantia.
- Desenhe cada sprite já ampliado: `drawImage(folha, sx, sy, 16, 16, round(x * S), round(y * S), 16 * S, 16 * S)`. Assim o boneco anda de 1 em 1 pixel de tela (liso), e não de 4 em 4, mantendo o pixel do desenho nítido. Sempre arredonde o destino.
- Fundo: monte a praça uma vez num canvas fora da tela já na escala `S` e copie inteiro a cada quadro.
- Peça ao host zoom do navegador em 100% e tela cheia. Com zoom ou escala do sistema em 125% o `devicePixelRatio` fica fracionário; a conta acima ainda mantém o pixel inteiro, mas a margem muda.

### Interpolação entre snapshots de SSE

Recomendo **perseguir o alvo com velocidade limitada**, em vez da interpolação por `alpha` do Calegario:

- Cada boneco tem no cliente uma posição desenhada `(rx, ry)` e um alvo `(tx, ty)` vindo do último snapshot.
- A cada quadro: `passo = min(distância, velocidade * dt)`, andando em linha reta para o alvo. `velocidade` é a do andar na simulação com uns 15% de folga, para alcançar.
- Se a distância passar de uns 4 tiles (entrada, reposição de fase), teleporta.
- `dt` limitado a 100 ms, para a aba que voltou do segundo plano não dar um salto.

Por que esta e não a outra:

- A 4 ou 5 snapshots por segundo, o `alpha` linear precisa do intervalo certo; com atraso de rede o boneco para e arranca a cada envio. Perseguir dá velocidade constante, que é o que combina com o ciclo de andar.
- Não depende de relógio do servidor e tolera evento perdido e reconexão.
- Direção e animação saem do movimento **desenhado**, não do dado: anda quando a distância é maior que meio pixel; a direção é o eixo dominante de `(tx - rx, ty - ry)`, com folga para não tremer na diagonal (só troca de eixo se o outro for 20% maior).

Melhor ainda, se a simulação puder mandar o destino da ação "andar até" além da posição atual: o cliente anda direto para lá e os snapshots só corrigem desvio.

### Animação

- Andando: linhas 0 a 3 a 8 quadros por segundo, na coluna da direção. Parado: linha 0.
- Some a cada boneco um deslocamento de fase tirado do `id`, para os 30 não pisarem juntos.
- Conversando: vire o boneco para o interlocutor.
- No desfile: alternar parado e pulo (linha 5) a 150 batidas por minuto, o andamento do frevo na spec, faz a praça pulsar com a música.
- Ordene por `y` antes de desenhar. Sombra primeiro, depois boneco, depois figurino.

### Balões legíveis do fundo da sala

Balões em **DOM**, sobre o canvas, com fonte de sistema. Texto em canvas não quebra linha sozinho e fonte de pixel com acento é um risco.

- **Tamanho:** 28 a 32 px em 1080p (`7 * S` px), peso 600 ou mais, texto escuro sobre branco quase opaco, borda escura de 3 a 4 px. Numa projeção de 2 m de altura, 28 px dão letras de uns 5 cm.
- **Conteúdo:** nome do boneco pequeno em cima, fala em até 2 linhas e cerca de 50 caracteres, com reticências. A fala inteira vai para o celular e para a lista lateral.
- **Limite:** no máximo 5 ou 6 balões com texto ao mesmo tempo. Os demais bonecos que estão falando ou pensando mostram só o balãozinho de três pontos do pacote (16x16, ampliado). Prioridade: fala mais nova e, entre iguais, a que importa para a fase (proposta de bloco, nome, refrão).
- **Duração:** `2 s + 60 ms por caractere`, teto de 6 s, com 150 ms de entrada e saída. O cliente conta pelo próprio relógio a partir de quando viu a fala; para isso cada fala precisa de um identificador ou número de sequência no snapshot.
- **Posição:** acima da cabeça, presa dentro do retângulo do mundo. Para não empilhar, vá pela prioridade e teste quatro posições (acima, acima à esquerda, acima à direita, abaixo); a primeira que não cruza um balão já colocado ganha, e se nenhuma servir o boneco fica só com os três pontos. Recalcule quando o conjunto de balões mudar ou a cada 250 ms, e suavize a posição entre recálculos.
- **Seguir o boneco:** mova o elemento com `style.transform` dentro do mesmo laço de animação. O React só monta e desmonta balões.
- **Largura máxima:** cerca de 22% do mundo (340 px em 1080p). Seis balões cobrem menos de um quinto da praça.
- **Fases 2 e 3:** troque balão por cartão. Um cartão fixo por bloco no ponto de encontro (nome e refrão) e, no desfile, o refrão grande numa legenda embaixo. O texto que importa não deve depender de balão.
- **Lista lateral:** as últimas 6 falas com o retrato 38x38, no painel. Nada se perde quando um balão é rebaixado.

Sobre a fonte do pacote (`Ui/Font/NormalFont.ttf`): tem os acentos do português, e o autor confirmou num comentário da página que ela também é CC0. No meu teste com PIL os espaços entre palavras sumiram; não testei num navegador. Não copiei e não recomendo depender dela hoje.

### Celular

Um boneco só não precisa de canvas: um `<div>` com a folha como `background-image`, `image-rendering: pixelated`, `background-size` em múltiplo inteiro (por exemplo 64x112 ampliado 6 vezes) e `animation` com `steps(4)` no `background-position-y`. Mais o retrato de `faces/` e o ícone do instrumento.

---

## 8. Textos de crédito prontos

### README da experiência

```md
## Créditos

- **Arte:** [Ninja Adventure - Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack), de Pixel-Boy e AAA, em Creative Commons Zero (CC0 1.0). A página do pacote no itch.io declara: "They are released under the Creative Commons Zero (CC0) license." (consultada em 2026-11-11). O repositório do autor no GitHub ([pixel-boy/NinjaAdventure](https://github.com/pixel-boy/NinjaAdventure)) não tem arquivo de licença; a referência é a página do itch.io e o `LICENSE.txt` que vem dentro do zip, copiado aqui como `NINJA-ADVENTURE-LICENSE.txt`. Os arquivos do pacote estão sem alteração.
- **Ícones dos instrumentos de frevo:** desenhados para esta experiência; não fazem parte do pacote.
- **Inspiração:** o mundo 2D é inspirado no World de Filipe Calegario em [gambiarraclub/gambiarra-arena](https://github.com/gambiarraclub/gambiarra-arena) (licença MIT, © 2025 Gambiarra LLM Club). O código do Bloco de frevo foi escrito do zero.
```

### Tela final

```text
Arte: Ninja Adventure, de Pixel-Boy e AAA (CC0)
pixel-boy.itch.io/ninja-adventure-asset-pack

Inspirado no World de Filipe Calegario
github.com/gambiarraclub/gambiarra-arena (MIT)
```

---

## 9. Dúvidas e ressalvas de licença

1. **O CC0 está bem amparado.** Três fontes concordam: a frase na página, o campo "Asset license" do itch.io e o `LICENSE.txt` dentro do zip. A frase da página começa com "They", sem dizer a quê se refere (vem depois do parágrafo sobre os projetos Godot); o `README.md` do zip desfaz a ambiguidade ao pôr a mesma frase sob "License", logo depois de "Assets created by".
2. **CC0 não cobre marca registrada** (item 4a do texto). Por isso deixei de fora os personagens que lembram os de outros jogos. A lista da seção 3 é julgamento meu.
3. **Crédito não é exigido**, mas o autor pede o link da página. Os textos da seção 8 atendem.
4. **A spec fala em "pixel-boy"; o pacote tem dois autores**, Pixel-Boy e AAA. Os textos de crédito citam os dois.
5. **Calegario:** o `LICENSE` do `gambiarra-arena` atribui o copyright a "Gambiarra LLM Club", não a ele pessoalmente. Como o código é escrito do zero, o aviso MIT não é obrigatório; o crédito é cortesia e exigência da spec. Se algum trecho for copiado, aí o aviso MIT com o copyright precisa acompanhar.
6. **Meus rascunhos** (ícones de frevo e praça montada) não têm restrição; os ícones são originais e a praça é composição de tiles CC0.

## 10. Pendências para quem pegar o #19

- Decidir o centro da praça: medalhão com a bacia (como no rascunho), só o medalhão, ou o laguinho. Se houver fonte, ela vira obstáculo na simulação.
- Casar as coordenadas da simulação (#11) com o mundo de 384x256 e fixar os pontos de encontro dos blocos (até 10).
- Retocar o pandeiro e validar os oito ícones em escala de telão.
- Os PNGs são cópias idênticas às originais. Recomprimir não compensa: regravar as 30 folhas de personagem com o PIL em modo otimizado baixou de 170 KB para 166 KB.
