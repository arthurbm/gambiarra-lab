# Bloco de frevo: lista de conferência (10 minutos, de manhã)

Para decidir se o Bloco de frevo vai ao palco às 16h40 ou se entra o vídeo no lugar. Os vídeos e o relatório de carga estão em `artifacts/bloco-de-frevo/`, no checkout principal do repositório (`~/Videos/bloco-de-frevo` é um link para lá).

## O que já foi conferido (2026-11-11, de madrugada, contra o deploy)

Em `artifacts/bloco-de-frevo/`:

| Arquivo | O que mostra |
|---|---|
| `telao-melhores-momentos-1min.mp4` | Um minuto do telão: QR, chegada, encontros, nomes, desfile, a música do júri (um quadro parado da rodada anterior) e a tela final |
| `telao-dinamica-inteira-da-entrada-ate-a-tela-final.mp4` | O telão em 1920x1080, 9 min 13 s, com 25 bonecos simulados e modelos reais, da entrada com o QR até a tela final |
| `celular-entrevista-bloco-votos-e-resultado.mp4` | Um celular (390x844): entrevista, bloco com os outros dois, voto do refrão, desfile e "Seu bloco foi escolhido pelo júri!" |
| `admin-iniciar-avancar-marcar-tres-blocos-e-tocar.mp4` | O admin: preencher, iniciar, avançar as fases, marcar três blocos, tocar e repetir a música |
| `carga-25-celulares.md` | 25 celulares pela internet numa dinâmica inteira: 0 erros, 0 reconexões, US$ 0,08 |
| `capturas-telao/`, `capturas-telao-3/` | Uma captura do telão por fase, das duas rodadas |

Os vídeos não têm som (o navegador da gravação não tem saída de áudio). A música gerada tocou no telão da segunda rodada; o admin registrou "tocando".

## Endereços

| O quê | Endereço |
|---|---|
| Telão (abrir no projetor, tela cheia) | https://mundo-production-7b9b0ad9.up.railway.app/telao |
| Celular (o QR do telão aponta para cá) | https://mundo-production-7b9b0ad9.up.railway.app/ |
| Admin | `https://mundo-production-7b9b0ad9.up.railway.app/admin?k=<segredo>` |
| Saúde do servidor | https://mundo-production-7b9b0ad9.up.railway.app/health |

O link de admin completo, com o segredo, está só neste notebook, em `~/.config/gambiarra-lab/admin-link.txt` (o segredo sozinho está em `~/.config/gambiarra-lab/admin.secret`). Não cole o link em chat, slide ou tela compartilhada.

## Antes de começar (dois minutos)

1. No admin, toque em **Reiniciar do zero…** e confirme em **Sim, reiniciar do zero**: volta à entrada com a praça vazia e zera o gasto estimado. Confira em "Modelos e gasto" que está em US$ 0,00; se não, toque em **Zerar o gasto**. O gasto soma entre ensaios enquanto o servidor não reinicia; o teto é US$ 1 por vida do servidor (`FREVO_BUDGET_USD`) e, ao passar dele, todos os bonecos vão para o piloto automático (continuam andando, mas sem modelo).
2. Ainda em "Modelos e gasto", confira o **MiniMax M3**. Nas duas rodadas com modelos reais de hoje cedo (06h10 e 06h26) ele falhou em mais da metade das chamadas (45 de 73 e 43 de 78). A causa: sob carga o OpenRouter o mandava para o provider Venice, que gasta os 400 tokens raciocinando e responde sem chamar a ferramenta. A correção (branch `fix/ajustes-de-palco`) desliga o raciocínio e prefere a CoreWeave; com ela, 21 de 21 numa rajada direta e 44 de 44 pelo hub. **Se o deploy em uso já tem essa correção, deixe o MiniMax ligado; se não tem, desligue-o.** Desligado, os bonecos dele pensam com os outros modelos.
3. No admin, seção "Júri": **Música gerada no fal.ai: restam N de 6 gerações.** São seis por vida do servidor (`FREVO_MUSIC_MAX_GENERATIONS`); reiniciar pelo admin não devolve. Cada bloco marcado gasta uma. Se restarem menos de 3, rode `railway redeploy --service mundo --yes` (de dentro do repo ligado ao projeto, ver o fim desta lista): o servidor volta com 6, a praça vazia e a mesma Room. Sem gerações, toca a base de reserva.
4. No telão, toque em **Ativar som** (canto superior direito do palco) com um toque ou clique de verdade. O navegador só toca áudio depois disso; o admin mostra "Som do telão: ativado" quando deu certo. Se o botão continua lá, o navegador recusou: toque de novo.
5. Saúde: `curl -s https://mundo-production-7b9b0ad9.up.railway.app/health` deve mostrar `"ok":true`, um `room` e `"participants":12`.

Tetos que valem durante a apresentação:

- **30 bonecos na praça** (`FREVO_MAX_BONECOS`). O 31º celular lê "A praça lotou". Bonecos simulados contam: se for preencher a praça, deixe vaga para o público (por exemplo, simulados só até 10 quando a sala tiver 20 pessoas).
- **6 músicas geradas** por vida do servidor (item 3 acima). Marque só os três blocos do júri.
- **US$ 1 de modelos** por vida do servidor; uma dinâmica inteira com 25 bonecos gastou US$ 0,07 a 0,08 nas rodadas de hoje.

## Os cinco itens

### 1. O QR abre no celular e o boneco aparece no telão em poucos segundos

- **Abrir:** o telão no notebook; apontar a câmera do seu celular para o QR.
- **Esperar:** o celular abre a página, mostra o boneco com nome e figura e começa a entrevista; o mesmo boneco aparece na praça do telão em até uns 3 segundos. Na carga de hoje com 25 celulares pela internet contra este endereço, o boneco apareceu no telão em 0,4 s (mediana; máximo 0,5 s), sem erro e sem reconexão (`artifacts/bloco-de-frevo/carga-25-celulares.md`).
- **Se falhar:**
  - O QR não abre: digite o endereço do celular à mão. Se a página não carrega, veja `/health`; se não responde, rode `railway logs --service mundo --lines 100` e, se o serviço caiu, `railway redeploy --service mundo --yes` (de dentro do repo, ligado ao projeto como no fim desta lista), ou vá para o plano B.
  - O boneco não aparece no telão: recarregue o telão (ele reconecta sozinho e recebe o mundo inteiro).

### 2. As perguntas do boneco estão boas em português

- **Abrir:** o seu celular, na entrevista.
- **Esperar:** três perguntas de toque, com opções escritas pelo modelo e sabor do Recife, e uma pergunta aberta opcional. No fim, uma personalidade de duas linhas e um instrumento de frevo.
- **Se falhar:** se um modelo escreve mal (caracteres estranhos, frases sem sentido), desligue esse modelo no admin ("Modelos e gasto"); os bonecos dele passam a pensar com os outros. Se todos falharem, o boneco usa perguntas fixas e segue.
- **Texto no telão:** desde a branch `fix/ajustes-de-palco`, todo prompt proíbe falar de cor, raça, etnia, corpo, aparência, gênero, idade, religião ou origem de alguém, apelido ou gíria para chamar alguém e duplo sentido, e a lista de bloqueio derruba a família de "nêgo" e outros termos desse tipo (o texto inteiro cai e entra a reserva). A pergunta não sai mais com "Pergunta 2 de 3:" na frente, e as falas variam o começo em vez de abrir com "Oxe". Medição com modelos reais pelo hub, 12 perguntas e 4 refrões por modelo: nenhum termo barrado, nenhum prefixo, nenhuma fala abrindo com "Oxe" nos cinco modelos; nenhum foi trocado no catálogo. Os bonecos Preta, Galeguinho e Seu Lula agora se chamam Manga, Frevinho e Seu Zé.

### 3. Um bloco se forma e o celular mostra os outros dois

- **Abrir:** admin, **Preencher** a praça até 25 bonecos simulados (no ensaio; no palco, só o bastante para completar a sala, sem passar de 30 bonecos no total), e **Iniciar: Conhecer e formar**.
- **Esperar:** em até 2,5 min, os bonecos se encontram, falam e formam blocos de três; no celular aparecem as conversas e depois os outros dois do bloco. Ao fim da fase, quem sobrou é agrupado pelo maestro.
- **Se falhar:** se nenhum bloco se forma, avance a fase no admin: o maestro (ou o agrupamento por proximidade, se o maestro falhar) põe todo mundo num bloco.

### 4. O admin avança as fases e marca três blocos

- **Abrir:** admin.
- **Esperar:** **Avançar para Compor**, depois **Avançar para Desfile e júri**; no desfile, **Marcar** em três blocos (o quarto fica desabilitado) e **Avançar para Final**. O telão acompanha cada passo.
- **Se falhar:** recarregue o admin (o segredo vai no cabeçalho, a página lê do link). Se o admin responde "segredo inválido", o link não é o do `admin-link.txt`.

### 5. Uma música toca, ou a base de reserva

- **Abrir:** admin, no desfile, **Tocar** num bloco escolhido; telão com som ativado.
- **Esperar:** o telão toca a música e mostra o refrão do bloco. Sem música gerada pronta, toca a base de reserva (`/audio/reserva-2.mp3`).
- **Se falhar:** confira "Som do telão" no admin; se está desativado, toque em **Ativar som** no telão. Confira o volume do notebook e do projetor. Teste direto: https://mundo-production-7b9b0ad9.up.railway.app/audio/reserva-2.mp3

## Durante a apresentação

- **Não faça push nem merge na `main`.** Os serviços seguem a `main`: um push que toque os padrões de rebuild de um serviço o redeploya, e um redeploy do `mundo` zera a dinâmica, e um do `hub` apaga a Room. Para blindar, antes de subir ao palco: `railway service source disconnect --service <nome>` em cada serviço.
- Gasto: o admin mostra o gasto estimado; uma dinâmica inteira com 25 bonecos gastou cerca de US$ 0,08 hoje.
- Se os modelos falharem, os bonecos continuam andando no piloto automático; o telão não congela.

## Plano B: tudo no notebook com docker compose

Se a Railway ou a internet do local falharem. Precisa de Docker e dos arquivos em `~/.config/gambiarra-lab/` (`openrouter.key`, `fal.key`, `admin.secret`). O primeiro build leva alguns minutos; faça uma vez antes de sair para o evento, para ficar em cache.

```bash
cd ~/Documents/PESSOAL/GAMBIARRA-CLUB/gambiarra-lab
git checkout main && git pull
# Celulares na mesma rede Wi-Fi do notebook: use o IP do notebook no QR.
FREVO_PUBLIC_URL=http://$(hostname -I | awk '{print $1}'):3001 docker compose up --build -d --wait
```

- Telão: http://localhost:3001/telao · Admin: `http://localhost:3001/admin?k=<conteúdo de ~/.config/gambiarra-lab/admin.secret>`
- Sem internet: `FREVO_MODEL_HOST_MODE=fake docker compose up --build -d --wait` (modelos falsos, sem gasto; os bonecos falam frases prontas).
- Logs: `docker compose logs -f mundo` · Parar: `docker compose down`
- Se nada funcionar: passe o vídeo do telão (`artifacts/bloco-de-frevo/telao-melhores-momentos-1min.mp4` ou o inteiro).

## Depois do evento: derrubar tudo

```bash
cd ~/Documents/PESSOAL/GAMBIARRA-CLUB/gambiarra-lab
railway link --project 11908982-91b4-4956-bfe2-b68de2283d62 --environment production
for s in hub modelos mundo; do railway scale --service "$s" us-east=0; done   # para os serviços e mantém o projeto
# ou apaga o projeto inteiro:
railway delete --project 11908982-91b4-4956-bfe2-b68de2283d62 --yes
docker compose down                                                          # se o plano B ficou de pé
```

A assinatura Hobby da Railway (US$ 5 por mês) continua até ser cancelada no painel da Railway. Para revogar a key do OpenRouter e a do fal.ai, use o painel de cada um.
