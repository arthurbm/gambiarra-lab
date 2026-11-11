# Bloco de frevo

`@gambiarra-lab/frevo` is the server side of the Bloco de frevo, a 2D square where each person in the audience gets a boneco: a personal agent that thinks with a model of the Room. `@gambiarra-lab/frevo-web` is its web (telão, phone, admin). The spec is issue #10.

What runs today: people scan the QR on the telão, get a boneco with a drawn name and look and a model of the Room (spread evenly), and the boneco interviews them on the phone: three tap questions the model writes, one optional open question, then a two-line personality and a frevo instrument. Afterwards, and for the simulated bonecos, a boneco asks a model where to go, walks there and says its line in a balloon. With no model it keeps walking on autopilot and the interview uses fixed questions.

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
| `PORT`, `HOST` | world | `3200`, `0.0.0.0` |
| `FREVO_BONECOS` | world | `1` simulated boneco |
| `FREVO_DECISION_TIMEOUT_MS` | world | `12000` |
| `FREVO_ADMIN_SECRET` | world | drawn at start and printed as `/admin?k=<secret>` |
| `FREVO_BUDGET_USD` | world | `1`: estimated session spending that puts every boneco on autopilot |
| `FREVO_WEB_DIST` | world | `apps/frevo-web/dist` when built |
| `FREVO_PUBLIC_URL` | world | none; the QR falls back to the telão's origin |
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
  - `blocklist.ts` is the one filter for model text (`filterModelText`): blocked words and letters from other scripts drop the text before it enters the world, so nothing unfiltered reaches the telão.
- `brains/`: the brain scheduler. One `chat/completions` call per decision, without streaming, with one tool the model must call (`tool_choice: "required"`) and the `participantId` as the model selector. It keeps the free/busy table, because the hub serves one request at a time per participant, refuses a busy one with 409 and does not say who answered; a participant stays busy until the hub answered, even after the decision gave up. A decision goes to a free participant of the boneco's model, or to any free one after `fallbackMs` (1.5 s). The arguments are checked against the tool's schema (and refused with letters outside the Latin alphabet); an unusable answer is repeated once. `metrics.ts` counts decisions, failures and response time per model from the hub's `llm.complete`/`llm.error` events, with the caller's side as fallback when the hub's stream dropped, and estimates the spending (tokens times the catalog's price, or OpenRouter's `usage.cost` when higher).
- `models/catalog.ts`: the stage models, their labels, prices, request fields (reasoning at its minimum, `max_tokens`, provider routing, measured on 2026-11-11) and the fake stand-ins with their latency and failure rates. `minimax/minimax-m3` replaces `minimax/minimax-m3.1-flash` (issue #18).
- `model-host/`: the model host, the provider proxy (a local endpoint each participant points at; it adds the key and each model's request fields) and the fake provider, which answers any forced tool with arguments built from the tool's JSON schema.
- `server/`: HTTP and SSE. `GET /health`, `GET /events/telao`, `POST /api/entrar` (`{ sessao? }` → `{ sessao, boneco, created }`), `POST /api/responder` (`{ sessao, pergunta, opcao | texto | pular | digitando }`; 409 when the question already passed), `GET /events/celular?sessao=…` (the phone's private view), `GET /api/config` (`{ publicUrl }`), `GET /api/models` (the Room's models), `/api/admin/*` behind `Authorization: Bearer <FREVO_ADMIN_SECRET>` (`GET` and `POST /api/admin/models` with `{ model, enabled }`, `POST /api/admin/spending/reset`), and the built web for everything else. `GET /events/telao` carries the snapshot plus one row per model for the panel.
- `gambi/`: the Room by name on the management plane, its inference events (`room-events.ts`, reconnecting) and the call on the inference plane.
- `testing/`: hub and child processes on free ports for tests, the smoke and `frevo:dev`.

The web keeps the data flow apart from the drawing: `telao/stream.ts` keeps the connection (and reconnects when the browser gives up or the stream goes silent), `telao/world-view.tsx` draws one snapshot and knows nothing else.

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
