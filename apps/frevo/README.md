# Bloco de frevo

`@gambiarra-lab/frevo` is the server side of the Bloco de frevo, a 2D square where each person in the audience gets a boneco: a personal agent that thinks with a model of the Room. `@gambiarra-lab/frevo-web` is its web (telão, phone, admin). The spec is issue #10.

What runs today: people scan the QR on the telão, get a boneco with a drawn name and look and a model of the Room (spread evenly), and the boneco interviews them on the phone: three tap questions the model writes, one optional open question, then a two-line personality and a frevo instrument. Afterwards, and for the simulated bonecos, a boneco asks a model where to go, walks there and says its line in a balloon. With no model it keeps walking on autopilot and the interview uses fixed questions.

In the formar phase, two bonecos without a bloco that come close meet: each says one line to the other and declares whether their humans match, from both personalities (`meetRadius`; the same pair meets again only after `meetCooldownMs`). A boneco that matched two others without a bloco invites them; each human confirms by tap on the phone, the majority wins and whoever does not answer counts as yes. A bloco closes with exactly three and walks to its meeting spot; nobody in a bloco gets an invitation. When the phase closes, the maestro (one model call with every personality left) groups whoever is alone, in threes with one bloco of two or four when the count asks for it; if it fails or takes longer than `maestroMs`, the square groups them by distance. Whoever arrives later goes to the smallest bloco. The phone shows whom its boneco talked to and what each said, then the others of its bloco; the telão rings each boneco in its bloco's colour and keeps a short log of what just happened.

In the compor phase, each bloco gathers at its meeting spot and composes. Every boneco proposes a name (a model decision) and the bloco's humans vote on their phones; then every boneco proposes a refrain of two to four verses about what the humans share, from their personalities, and they vote again; when the phase has time left, a rework round puts "keep the refrain" first and the bonecos' adjustments after it. The most voted option wins, a tie is drawn by the world's generator, and with no vote the first proposal wins; a human who lets the countdown run out does not vote. A boneco whose model does not propose is left out of the round, and with no proposal at all the bloco gets a reserve name or refrain. Names over 40 characters and verses over 60 are refused, not cut, and every line goes through `filterModelText`. Blocos the maestro delivers late and late arrivals take part in whatever is still open. The phones of a bloco show the same options and how many already voted, also after voting; the proposals are balloons on the telão and each outcome goes to the log. When the phase ends, every bloco has `name` and `refrain`, even with no human and every model down.

In the desfile, the blocos parade on the telão one at a time, in the order they formed, each for an equal share of the phase (the host may go to the next or back to the previous one; pausing holds the bloco on stage). The telão shows the bloco's name, its refrain in big letters, its members as pixel-art bonecos and the models that thought for them; a bloco without a name or refrain from the compor phase parades as "Bloco N" with a default refrain. From the admin the host marks up to three blocos (marking prepares their music in the background) and plays, or plays again, each one's music on the telão, which shows that bloco's refrain while it plays. The browser plays sound only after a tap, so the telão shows an "Ativar som" button until the first one, and the admin shows whether the telão's sound is on. The final lists every bloco, the chosen ones first, with the models' summary and the credits. The phone shows its bloco's refrain in the desfile and, in the final, whether it was chosen. Restarting from the admin goes back to the entrance with the QR and forgets the desfile, the choices and the music.

## Run it

From the repository root:

```bash
bun install
bun run frevo:dev             # hub + world + model host + web, fake models
bun run frevo:dev -- --real   # same, with models from OpenRouter (spends money)
```

The telão is at `http://localhost:3201/telao` and the phone at `http://localhost:3201/`. The QR on the telão points at `FREVO_PUBLIC_URL`, or at the telão's own address; to scan it from a real phone in development, open the telão by the Network address Vite prints. `PORT` (world, 3200), `FREVO_WEB_PORT` (web, 3201) and `FREVO_HUB_PORT` (hub, 3210) move the ports; 0 asks the OS for a free one. `--no-web` skips Vite; the world then serves `apps/frevo-web/dist` when it was built.

`--real` reads the key from `OPENROUTER_API_KEY`, or from `~/.config/gambiarra-lab/openrouter.key` (`OPENROUTER_API_KEY_FILE` moves it). The key never reaches the hub or the repository.

```bash
bun run frevo:smoke        # runtime proof with a fake model; exits 0 or 1
bun run frevo:real-check   # 10 decisions per stage model through a hub (about US$ 0.006)
bun test apps/frevo/src apps/frevo-web/src
```

`frevo:smoke` builds the web, starts everything on free ports and checks, one line per step: the Room and its model participants, the web served by the world, a boneco deciding by a model, the model host dying (autopilot) and coming back, the hub restarting (new Room, the host joins again) and the telão reconnecting. `FREVO_SMOKE_VERBOSE=1` streams the children's output.

## The three processes

| Process | Entry | What it does |
|---|---|---|
| hub | `gambi hub serve` | The published Gambi hub. Never exposed to the internet: it has no auth. |
| model host | `src/model-host/index.ts` | Keeps model participants open in the Room. The only place with the provider key. |
| world | `src/server/index.ts` | Runs the simulation, asks the Room for decisions, serves SSE and the built web. The only public service. |

The world creates the Room, or reuses the one with the same name (`FREVO_ROOM_NAME`, default `bloco-de-frevo`). Room codes are generated and Rooms do not survive a hub restart, so the name is the key: the model host finds the Room by name and joins again whenever its tunnel closes, and the world creates the Room again when the hub stops knowing it.

### Environment

| Variable | Process | Default |
|---|---|---|
| `GAMBI_HUB_URL` | world, model host | `http://127.0.0.1:3210` |
| `FREVO_ROOM_NAME` | world, model host | `bloco-de-frevo` |
| `PORT`, `HOST` | world | `3200`, `::` (IPv6 and IPv4) |
| `FREVO_BONECOS` | world | `0`: bonecos with nobody behind them, walking on their own (`frevo:dev` asks for `1`) |
| `FREVO_MAX_BONECOS` | world | `30`: bonecos the square holds; a new phone then reads "A praça lotou" |
| `FREVO_DECISION_TIMEOUT_MS` | world | `12000` |
| `FREVO_ADMIN_SECRET` | world | drawn at start and printed as `/admin?k=<secret>` |
| `FREVO_BUDGET_USD` | world | `1`: estimated session spending that puts every boneco on autopilot; the admin's `reiniciar` counts it from zero again |
| `FREVO_WEB_DIST` | world | `apps/frevo-web/dist` when built |
| `FREVO_PUBLIC_URL` | world | none; the QR falls back to the telão's origin |
| `FREVO_MODEL_HOST_PORT`, `HOST` | model host | a free port, `::`; where `GET /health` answers |
| `FREVO_MODEL_HOST_MODE` | model host | `openrouter`; `fake` needs no key and no network |
| `FREVO_MODELS` | model host | the twelve participants of `src/models/catalog.ts` (`model[:participants]`, comma separated) |
| `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE` | model host | the file in `~/.config/gambiarra-lab/` |
| `OPENROUTER_BASE_URL` | model host | `https://openrouter.ai/api/v1` |
| `FREVO_FAKE_LATENCY_MS` | model host (fake) | each fake model's own range in the catalog |
| `FREVO_FAKE_FAILURES` | model host (fake) | on; `0` turns the fake models' errors and unusable answers off |

## Modules

One directory per module under `src/`:

- `sim/`: the world simulation. Pure: no I/O, no real clock, and its only randomness is a seeded generator in the state. `step(world, { elapsedMs, results, models })` returns the next world and the decisions it waits for; `publicSnapshot(world)` is what the telão may show and `privateView(world, session)` what one phone shows. `join` and `answerHuman` take what people do on their phones.
  - Phases are declared in order (`PHASES`: `entrada`, `formar`, `compor`, `desfile`, `final`); the world starts at `entrada`.
  - `ask.ts` is the boneco asking its human something with a countdown (`askMs`, 12 s) and deciding alone, with a notice, when nobody answers. Each use is a `purpose` with a handler in `ASK_HANDLERS` (`world.ts`); the interview is the first, confirming a bloco and voting are next. Typing in an open question pushes the countdown, up to `askTypingCapMs`.
  - `interview.ts` keeps what the interview knows and its fixed texts (reserve questions, open question, fallback personality, instruments). The free text goes into the personality request and nowhere else.
  - `phases.ts` moves the phases: `tick(world, input)` is `step` plus the phase clock, and the one the server runs. `entrada` and `final` wait for the host; `formar`, `compor` and `desfile` run for their durations (2.5, 2.5 and 3 min by default, `setPhaseDurations` before or during) and the next starts when the time is up. `setPaused` freezes the phase clock and every question's countdown while the bonecos keep walking. `advancePhase` runs `PHASE_HOOKS[phase].onExit`, then the next phase's `onEnter`: each phase plugs its rules in there. `restartWorld` goes back to `entrada` with nobody, keeping the durations. `phaseStatus(world)` is what the screens show.
  - `admin.ts` is moderation: `setSilenced` hides a boneco's lines from the telão (its balloons, and the log lines that quote its proposals; a name or refrain its bloco chose stays the bloco's); `expel` removes it and runs `BONECO_REMOVED_HOOKS`, where a phase that keeps bonecos elsewhere (a bloco, a vote) drops the one that left.
  - `compor.ts` is the compor phase: the name, refrain and rework rounds per bloco, votes (an ask with purpose `voto`; the outcome lands in `boneco.ballot` until the round reads it) and the reserve name and refrain. `enterCompor`/`closeCompor` are `PHASE_HOOKS.compor`; `stepCompor` runs on every step after `stepFormar`; decisions of kind `nome` and `refrao` are settled there. `bloco.name` and `bloco.refrain` (one verse per item) are on the bloco and in the public snapshot; the phone's view has `compor` (round, options, votes, voters, its own vote). The refrain decision is sent with `max_tokens` of `REFRAIN_MAX_TOKENS` (700).
  - `formar.ts` is the formar phase: encounters, invitations, blocos, the maestro, the grouping by distance and late arrivals. The world calls `stepFormar` on every step; `enterFormar(world)` and `closeFormar(world)` are its `PHASE_HOOKS.formar` (`onEnter`, `onExit`, wired in `phases.ts`), so the host opens it with `iniciar` and it closes when its time is up or the host advances. An expelled boneco leaves its bloco and any pending invitation (a `BONECO_REMOVED_HOOKS` entry). `world.blocos` lists each bloco with its members and its meeting spot (`blocoSpot`, from `meeting-spots.ts` on the square). The maestro answers on a step after `closeFormar`, so blocos made by it appear up to `maestroMs` later.
  - `desfile.ts` is the desfile and the final (`PHASE_HOOKS.desfile` and `.final`). `world.desfile` keeps the bloco the host last put on stage and the chosen bloco ids, in the order they were marked; the bloco on stage is derived from the phase clock, so nothing steps here. `desfileView(world)` is what the telão and the admin show, `phoneDesfile(world, bonecoId)` what a phone shows, `nextBloco`/`previousBloco` and `setChosen(world, blocoId, chosen)` (at most `MAX_CHOSEN`, three) are the host's. The compor phase adds `name` and `refrain` to the bloco; `blocoName`/`blocoRefrain` read them with the fallbacks.
  - `events.ts` is the short log on the telão (`logEvent`); every phase may write to it. An event carrying a boneco's own line names it (`bonecoId`), and the telão leaves it out while that boneco is silenced. Restarting gives a new world, so blocos and events start empty again.
  - `blocklist.ts` is the one filter for model text (`filterModelText`): blocked words and letters from other scripts drop the text before it enters the world, so nothing unfiltered reaches the telão.
- `brains/`: the brain scheduler. One `chat/completions` call per decision, without streaming, with one tool the model must call (`tool_choice: "required"`) and the `participantId` as the model selector. It keeps the free/busy table, because the hub serves one request at a time per participant, refuses a busy one with 409 and does not say who answered; a participant stays busy until the hub answered, even after the decision gave up. A decision goes to a free participant of the boneco's model, or to any free one after `fallbackMs` (1.5 s). The arguments are checked against the tool's schema (and refused with letters outside the Latin alphabet); an unusable answer is repeated once. `metrics.ts` counts decisions, failures and response time per model from the hub's `llm.complete`/`llm.error` events, with the caller's side as fallback when the hub's stream dropped, and estimates the spending (tokens times the catalog's price, or OpenRouter's `usage.cost` when higher).
- `models/catalog.ts`: the stage models, their labels, prices, request fields (reasoning at its minimum, `max_tokens`, provider routing, measured on 2026-11-11) and the fake stand-ins with their latency and failure rates. `minimax/minimax-m3` replaces `minimax/minimax-m3.1-flash` (issue #18).
- `model-host/`: the model host, the provider proxy (a local endpoint each participant points at; it adds the key and each model's request fields) and the fake provider, which answers any forced tool with arguments built from the tool's JSON schema. `health.ts` is the host's only public route, `GET /health`: 200 while the process runs, with how many participants joined. The provider proxy listens on `127.0.0.1` on a free port, inside the process's machine only.
- `server/`: HTTP and SSE. `GET /health`, `GET /events/telao`, `POST /api/entrar` (`{ sessao? }` → `{ sessao, boneco, created }`; 409 `{ lotado: true }` for a new person once the square holds `FREVO_MAX_BONECOS`), `POST /api/responder` (`{ sessao, pergunta, opcao | texto | pular | digitando }`; 409 when the question already passed), `GET /events/celular?sessao=…` (the phone's private view), `GET /api/config` (`{ publicUrl }`), `GET /api/models` (the Room's models), `/api/admin/*` behind `Authorization: Bearer <FREVO_ADMIN_SECRET>` (`GET` and `POST /api/admin/models` with `{ model, enabled }`, `POST /api/admin/spending/reset`), and the built web for everything else. `GET /events/telao` carries the snapshot, the phase clock (`clock`) and one row per model for the panel; a phone's stream carries its view with `clock`, or `{ expulso: true }` (the session stays out until the host restarts: `POST /api/entrar` answers 403) or `{ reiniciou: true }` (entering again gives a new boneco). The host's routes are in `server/admin.ts`: `GET /api/admin/estado`, `GET /api/admin/eventos` (SSE, read with fetch so the secret stays in the header), and `POST` `iniciar`, `pausar`, `retomar`, `avancar`, `duracoes` (`{ formar?, compor?, desfile? }` in ms), `reiniciar` (also lets the expelled back in and sets the spending to zero), `simulados` (`{ total }`, default 25, never past `FREVO_MAX_BONECOS`), `simulados/remover`, `expulsar` (`{ boneco }`), `silenciar` (`{ boneco, silenciado }`), and the jury's `desfile/proximo`, `desfile/anterior`, `desfile/escolher` (`{ bloco, escolhido }`; 409 with the reason past three or outside the desfile and the final), `desfile/tocar` (`{ bloco }`, also to play again) and `desfile/parar`; the admin's state carries `jury` (the desfile, each chosen bloco's music, the last command and the telão's sound); a ticket adds its own admin routes through `otherRoutes`, behind the same secret. `server/simulated.ts` is the simulated people: sessions that join like a phone and answer any open question by its shape (choices or text), after 1.2 to 9 s, letting about 8% run out. While no SSE stream is open (telão, phone or admin) and no accepted API call (a 2xx answer) came in the last 5 s, the server sends no decision to the scheduler and the bonecos walk on autopilot, so a deploy left up all day spends nothing on models. Simulated people are not viewers: they join and answer inside the process, without a stream or an API call. A new SSE route (the admin's `GET /api/admin/eventos` included) must call `watch()` to count as a viewer; `GET /health` reports `viewers`.
- `music/`: the jury's music. `generator.ts` is the one-function interface (`MusicGenerator`: bloco name, refrain and style in, `{ url }` out) and its default, which answers with the embedded track (`/audio/reserva-2.mp3`, served by the web from `apps/frevo-web/public/audio/`, with `reserva-1` and `reserva-3` beside it); `startWorldServer({ music })` takes another. `jukebox.ts` runs it on the server: marking a bloco prepares its music once, in the background; a generator that fails or takes longer than `musicTimeoutMs` (105 s) leaves the embedded track, and so does playing before the music is ready. Every play or stop is a command with a growing id in the telão's snapshot (`audio`); the telão reports its sound with `POST /api/telao/som` (`{ telao, ativo, tocando }`) every 5 s.
- `gambi/`: the Room by name on the management plane, its inference events (`room-events.ts`, reconnecting) and the call on the inference plane.
- `testing/`: hub and child processes on free ports for tests, the smoke and `frevo:dev`.

The web keeps the data flow apart from the drawing: `telao/stream.ts` keeps the connection (and reconnects when the browser gives up or the stream goes silent), `telao/world-view.tsx` draws one snapshot and knows nothing else.

## Deploy

Three services from this repository, on Railway (project `bloco-de-frevo`, environment `production`, region `us-east4-eqdc4a`) and in `docker compose` on a notebook as plan B.

| Service | Dockerfile | Network | Health | Secrets |
|---|---|---|---|---|
| `hub` | `deploy/frevo/hub.Dockerfile` | private only, `hub.railway.internal:3000` | `/v1/health` | none |
| `modelos` | `deploy/frevo/modelos.Dockerfile` | private only | `/health` on 3002 | `OPENROUTER_API_KEY` |
| `mundo` | `deploy/frevo/mundo.Dockerfile` | the only public domain | `/health` on 3001 | `FREVO_ADMIN_SECRET`, `FAL_KEY` |

Every server listens on `::`: Railway's private network needs IPv6 and `0.0.0.0` refuses it. The hub ignores `PORT`, so it gets `--port` by flag and `PORT` repeats the value only for the healthcheck. Hub state is memory only: any redeploy or restart of the hub wipes the Rooms (the world and the model host recover by name).

The SSE stream sends `: keepalive` every 15 s (Railway closes a connection idle for 5 minutes) and the route turns Bun's 10 s idle timeout off. Railway also cuts any HTTP request at 15 minutes; the telão reconnects and the world sends the whole snapshot on connect.

### Configuration as code

`.railway/railway.ts` is the configuration of the whole project, one block per service: Dockerfile path, healthcheck, one replica in one region, non-secret variables, and `preserve()` for the secrets. Railway deprecated the per-service `railway.json` (new services cannot use it, and it stops being read on 2026-12-01), so this file is it. Railway does not read it during a deploy; the CLI applies it. It needs Node >= 22 on `PATH` (the CLI evaluates it with `node --experimental-strip-types`) and the `railway` devDependency. Do not run `railway config` behind `timeout`, `env` or `bunx`. Do not write Railway's default values into it (sleep off, restart on failure): the plan then drifts forever and every apply redeploys the service.

### Variables per service

| Variable | hub | modelos | mundo |
|---|---|---|---|
| `HUB_PORT` | `3000` | | |
| `PORT` | `3000` | `3002` | `3001` |
| `GAMBI_HUB_URL` | | `http://${{hub.RAILWAY_PRIVATE_DOMAIN}}:${{hub.HUB_PORT}}` | same |
| `FREVO_ROOM_NAME` | | `bloco-de-frevo` | `bloco-de-frevo` |
| `FREVO_MODEL_HOST_PORT` | | `3002` | |
| `FREVO_MODELS` | | unset: the twelve participants of `src/models/catalog.ts` | |
| `FREVO_BUDGET_USD` | | | `1` |
| `OPENROUTER_API_KEY` | | secret | |
| `FREVO_PUBLIC_URL` | | | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `FREVO_ADMIN_SECRET` | | | secret |
| `FAL_KEY` | | | secret |

The keys live in raw files in `~/.config/gambiarra-lab/` (`openrouter.key`, `fal.key`, `admin.secret`, all mode 600) and never reach the repository. Create the admin secret once:

```bash
(umask 077; openssl rand -hex 24 | tr -d '\n' > ~/.config/gambiarra-lab/admin.secret)
```

The admin link is `https://<mundo domain>/admin?k=<admin secret>`.

### Railway, from the repository root

```bash
railway link --project 11908982-91b4-4956-bfe2-b68de2283d62 --environment production
railway config plan                     # read only; must say what you expect
railway config apply --yes              # creates services and plain variables

# Secrets from file through stdin: not in argv, history or output.
railway variable set OPENROUTER_API_KEY --stdin --service modelos --skip-deploys --json < ~/.config/gambiarra-lab/openrouter.key
railway variable set FAL_KEY            --stdin --service mundo   --skip-deploys --json < ~/.config/gambiarra-lab/fal.key
railway variable set FREVO_ADMIN_SECRET --stdin --service mundo   --skip-deploys --json < ~/.config/gambiarra-lab/admin.secret

# Deploy the working directory (honours .gitignore and .railwayignore).
railway up --service hub     --ci -m "hub"       # only when its Dockerfile or the gambi version changes
railway up --service modelos --ci -m "modelos"
railway up --service mundo   --ci -m "mundo"

railway domain --service mundo --port 3001 --json   # once; the only public domain
```

Check by names, never by values (`railway variable list --json` and `--kv` print the values):

```bash
for s in hub modelos mundo; do railway variable list --service $s --json | jq -c 'keys'; done
for s in hub modelos mundo; do railway domain list --service $s --json; done   # hub and modelos: {"domains":[]}
railway logs --service mundo --build --lines 200 | grep -A1 -i healthcheck
curl -s https://<mundo domain>/health    # room, participants, bonecos, viewers
```

The deploy follows the working directory for now. After the merge to `main` (ticket #21), make each service follow `main`. Connecting deploys `main` right away, and without `watchPatterns` every push redeploys (a hub redeploy wipes the Rooms; do not merge during the show):

```bash
for s in hub modelos mundo; do
  railway service source connect --repo arthurbm/gambiarra-lab --branch main --service "$s"
done
```

### docker compose on the notebook

`compose.yaml` at the repository root builds the same three images. Only `mundo` publishes a port; the hub stays inside the compose network. The keys come in as compose secrets (`/run/secrets/*`), and `deploy/frevo/secrets-entrypoint.sh` turns each `FOO_FILE` into `FOO`, so `docker inspect` shows only paths.

```bash
docker compose up --build -d --wait     # telão at http://localhost:3001/telao
FREVO_MODEL_HOST_MODE=fake docker compose up --build -d --wait   # no key, no spend
FREVO_PUBLIC_URL=http://<notebook IP>:3001 docker compose up -d --wait   # QR for phones on the same network
docker compose logs -f mundo
docker compose down
```

The secrets arrive with the host file's owner and mode; the images run as uid 1000. On a machine where your uid is not 1000, add `user: "${UID}"` to `modelos` and `mundo`.

### Cost, and taking it all down after the event

With nobody watching, the world asks no model, so the deploy left up spends only Railway's small compute (about US$ 0.15 a day for the three services). The Hobby plan is US$ 5 a month and includes US$ 5 of usage.

```bash
railway usage
for s in hub modelos mundo; do railway scale --service "$s" us-east=0; done   # stop, keep the project
railway delete --project 11908982-91b4-4956-bfe2-b68de2283d62 --yes          # or delete everything
```

The subscription goes on until it is cancelled in Railway's dashboard.

## Art

The telão draws the square on a canvas at a whole scale (`apps/frevo-web/src/telao/scale.ts`): every art pixel becomes 3 device pixels on a 720p projector and 4 on a 1080p one, the world centred and the rest of the stage filled with scenery. Bonecos chase their latest position at a capped speed between snapshots (`telao/motion.ts`), walk in four directions and are sorted by depth with the props. Speech balloons are DOM: at most five, the newest speech first, each in the first spot around its boneco that covers no other (`telao/balloons.ts`).

| File | What it is |
|---|---|
| `apps/frevo-web/public/art/` | The pack's files, unchanged, and its `NINJA-ADVENTURE-LICENSE.txt` (CC0 1.0) and `NINJA-ADVENTURE-README.md` |
| `apps/frevo-web/src/art/characters.ts` | The 30 characters (`look` 0 to 29), the eight instruments, `lookOf` (`look ?? hash(id) % 30`) |
| `apps/frevo-web/src/art/boneco-sprite.tsx` | One boneco as a CSS sprite with its costume, standing or walking, for the phone |
| `apps/frevo-web/src/art/instrument-icons.ts` | The eight 16 x 16 instrument icons, drawn for this experience |
| `apps/frevo-web/src/art/credits.ts` | The credit lines, for the final screen |
| `apps/frevo-web/src/telao/scene.ts` | The square's tiles and props, built on `PRACA` and the meeting spots |
| `src/sim/meeting-spots.ts` | Where blocos gather, in map units (`@gambiarra-lab/frevo/meeting-spots`) |

`/telao/demo` runs the simulation in the browser with 30 bonecos and a fake brain, to check the art at full load without a hub (`?blocos` sends them to the meeting spots).

## Credits

- **Art:** [Ninja Adventure - Asset Pack](https://pixel-boy.itch.io/ninja-adventure-asset-pack), by Pixel-Boy and AAA, under Creative Commons Zero (CC0 1.0). The pack's page on itch.io says: "They are released under the Creative Commons Zero (CC0) license." (checked on 2026-11-11). The author's GitHub repository ([pixel-boy/NinjaAdventure](https://github.com/pixel-boy/NinjaAdventure)) has no license file; the reference is the itch.io page and the `LICENSE.txt` inside the zip, copied as `apps/frevo-web/public/art/NINJA-ADVENTURE-LICENSE.txt`. The pack's files are unchanged.
- **Frevo instrument icons:** drawn for this experience; not part of the pack.
- **Inspiration:** the square is inspired by the World of Filipe Calegario in [`gambiarraclub/gambiarra-arena`](https://github.com/gambiarraclub/gambiarra-arena) (MIT, © 2025 Gambiarra LLM Club), and written from scratch here.
