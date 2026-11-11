# Bloco de frevo: onde está cada coisa

Estado em 2026-11-11, dia da demonstração no Rec'n'Play. Confira se cada item ainda existe antes de depender dele.

## Origem

- Spec: issue #10. Tickets: #11 a #21. PR de integração: #22, já mergeado na `main` (a branch de integração não existe mais).
- Código: `apps/frevo`, `apps/frevo-web`, `scripts/frevo*.ts`, `deploy/frevo/`, `.railway/railway.ts`, `compose.yaml`.
- Lista de conferência do palco: [`conferencia.md`](conferencia.md). Itens adiados do code-review: [`../next-steps.md`](../next-steps.md).
- Notas de exploração de 2026-11-11, de antes ou durante a implementação, que podem estar desatualizadas (cada uma abre com o que mudou depois), em [`notas/`](notas/): [`gambi-sdk.md`](notas/gambi-sdk.md) (hub, Rooms, túnel, eventos), [`openrouter-modelos.md`](notas/openrouter-modelos.md) (modelos de palco, raciocínio, providers, custo), [`railway-deploy.md`](notas/railway-deploy.md) (Railway, rede privada, compose), [`musica-geradores.md`](notas/musica-geradores.md) (fal.ai, MiniMax e ElevenLabs) e [`arte-pixel.md`](notas/arte-pixel.md) (pacote Ninja Adventure, licença, renderização).

## Páginas públicas

| O quê | Endereço |
|---|---|
| Mundo: telão em `/telao`, celular em `/`, admin em `/admin?k=<segredo>` | https://mundo-production-7b9b0ad9.up.railway.app |
| Galeria de vídeos para compartilhar | https://bloco-de-frevo-videos.vercel.app |

A galeria não tem link para o mundo ao vivo nem para o admin, de propósito: um link público convidaria gente a entrar e gastar o teto de inferência.

## Deploys

**Railway** (o mundo, o hub e os modelos):

- Projeto `bloco-de-frevo`, id `11908982-91b4-4956-bfe2-b68de2283d62`, ambiente `production`.
- Serviços: `hub` (só rede privada), `modelos` (só rede privada, guarda a key do OpenRouter), `mundo` (o único público, guarda o segredo do admin e a key do fal.ai).
- Os três serviços seguem a `main` do GitHub (`source` em `.railway/railway.ts`): um push na `main` que toque os padrões de rebuild de um serviço (`watchPatterns`) o redeploya. O `hub` só rebuilda quando o próprio Dockerfile ou o `bun.lock` mudam.
- Redeploy do `mundo` derruba a dinâmica em memória; redeploy do `hub` apaga as Rooms. Antes de uma apresentação, não faça merge na `main`, ou desligue a origem com `railway service source disconnect --service <nome>`.
- `railway up --service <nome> --ci` a partir de um checkout continua valendo como deploy manual. Comandos em `apps/frevo/README.md`, seção "Deploy".

**Vercel** (a galeria):

- Projeto `bloco-de-frevo-videos`, site estático. Redeploy com `vercel deploy --prod --yes` a partir da pasta-fonte abaixo.

## Pastas na máquina do host

Os artefatos (vídeos, áudio, capturas, relatórios) ficam em `artifacts/bloco-de-frevo/`, dentro do checkout principal do repositório e ignorados pelo git; os worktrees não têm essa pasta. `~/Videos/bloco-de-frevo` é um link simbólico para ela. As keys ficam fora do repositório, de propósito.

| Pasta | Conteúdo |
|---|---|
| `artifacts/bloco-de-frevo/` (checkout principal) | Os quatro vídeos da demonstração, `musica/` (faixas de reserva, testes dos geradores e a faixa gerada pelo jukebox), `capturas*/`, os relatórios de carga (`carga-25-celulares.md`, `plano-b-compose-*.md`), a cópia da lista de conferência e as gravações brutas em `bruto/` |
| `artifacts/bloco-de-frevo/bloco-de-frevo-videos/` (checkout principal) | Fonte da galeria da Vercel: `index.html`, `videos/`, `audio/`, `img/` |
| `~/.config/gambiarra-lab/` | `openrouter.key`, `fal.key`, `ai-gateway.key`, `admin.secret` e `admin-link.txt` (o link de admin completo). Nunca imprima o conteúdo |

## Limites que valem saber

- O mundo limita uma sessão a US$ 1 de inferência, 30 bonecos e 6 gerações de música por vida do servidor.
- O saldo real do OpenRouter sai de `GET https://openrouter.ai/api/v1/credits`. O limite de uma key não é o saldo da conta.
- Sem ninguém conectado (telão, celular ou admin), o mundo não chama modelo nenhum.

## Trabalho pesado numa máquina de 16 GB

Em 2026-11-11, vários agentes em worktrees paralelos rodaram ao mesmo tempo a bateria de testes (que sobe hubs de verdade e faz um build da web), Chrome pelo `agent-browser`, `ffmpeg` e `docker compose`. O `systemd-oomd` matou a sessão gráfica do host duas vezes.

- Um trabalho pesado por vez: bateria de testes, smoke, build, navegador, vídeo ou Docker.
- `bun run test`, `frevo:smoke`, `board:smoke` e `frevo:load` passam por `scripts/heavy.ts`, que pega uma trava exclusiva em `~/.cache/gambiarra-lab/heavy.lock` (uma por máquina, a mesma para todos os worktrees; `GAMBIARRA_HEAVY_LOCK` muda o arquivo). Quem chega depois espera a vez e diz no stderr quem segura a trava (pid, pasta, comando, desde quando). A trava é `flock(2)` por `bun:ffi`, então funciona no Mac sem o comando `flock`, e o kernel a solta quando o processo morre, mesmo morto pelo `systemd-oomd`. Outro comando pesado entra na fila com `bun scripts/heavy.ts <comando>`.
- Ficam fora da trava, e continuam pedindo cuidado à mão: `docker compose`, o `agent-browser` (Chrome), `ffmpeg`, o build da web rodado direto e `frevo:dev`.
- Com vários agentes, cada um roda só os testes dos arquivos que tocou; a bateria completa roda uma vez, depois do merge.
- O T3 Code roda os agentes no slice de usuário `app-t3code-agents.slice`. O teto foi baixado com `systemctl --user set-property app-t3code-agents.slice MemoryHigh=6G MemoryMax=8G`; confira com `systemctl --user show app-t3code-agents.slice -p MemoryHigh -p MemoryMax`. O Docker roda fora desse slice.
