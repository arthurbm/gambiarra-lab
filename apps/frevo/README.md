# Bloco de frevo

`@gambiarra-lab/frevo` is the server side of the Bloco de frevo, a 2D square where each person in the audience gets a boneco: a personal agent that thinks with a model of the Room. `@gambiarra-lab/frevo-web` is its web (telão, phone, admin). The spec is issue #10.

What runs today is the walking skeleton: one simulated boneco asks a model participant of the Room where to go, walks there and says its line in a balloon on the telão. With no model it keeps walking on autopilot.

## Run it

From the repository root:

```bash
bun install
bun run frevo:dev             # hub + world + model host + web, fake models
bun run frevo:dev -- --real   # same, with models from OpenRouter (spends money)
```

The telão is at `http://localhost:3201/telao`. `PORT` (world, 3200), `FREVO_WEB_PORT` (web, 3201) and `FREVO_HUB_PORT` (hub, 3210) move the ports; 0 asks the OS for a free one. `--no-web` skips Vite; the world then serves `apps/frevo-web/dist` when it was built.

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
| `FREVO_MODEL_HOST_MODE` | model host | `openrouter`; `fake` needs no key and no network |
| `FREVO_MODELS` | model host, world | the twelve participants of `src/models/catalog.ts` (`model[:participants]`, comma separated); the world gives them in turns to simulated bonecos |
| `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_FILE` | model host | the file in `~/.config/gambiarra-lab/` |
| `OPENROUTER_BASE_URL` | model host | `https://openrouter.ai/api/v1` |
| `FREVO_FAKE_LATENCY_MS` | model host (fake) | each fake model's own range in the catalog |
| `FREVO_FAKE_FAILURES` | model host (fake) | on; `0` turns the fake models' errors and unusable answers off |

## Modules

One directory per module under `src/`:

- `sim/`: the world simulation. Pure: no I/O, no real clock, and its only randomness is a seeded generator in the state. `step(world, { elapsedMs, results })` returns the next world and the decisions it waits for; `publicSnapshot(world)` is what the telão may show.
- `brains/`: the brain scheduler. One `chat/completions` call per decision, without streaming, with one tool the model must call (`tool_choice: "required"`) and the `participantId` as the model selector. It keeps the free/busy table, because the hub serves one request at a time per participant, refuses a busy one with 409 and does not say who answered; a participant stays busy until the hub answered, even after the decision gave up. A decision goes to a free participant of the boneco's model, or to any free one after `fallbackMs` (1.5 s). The arguments are checked against the tool's schema (and refused with letters outside the Latin alphabet); an unusable answer is repeated once. `metrics.ts` counts decisions, failures and response time per model from the hub's `llm.complete`/`llm.error` events, with the caller's side as fallback when the hub's stream dropped, and estimates the spending (tokens times the catalog's price, or OpenRouter's `usage.cost` when higher).
- `models/catalog.ts`: the stage models, their labels, prices, request fields (reasoning at its minimum, `max_tokens`, provider routing, measured on 2026-11-11) and the fake stand-ins with their latency and failure rates. `minimax/minimax-m3` replaces `minimax/minimax-m3.1-flash` (issue #18).
- `model-host/`: the model host, the provider proxy (a local endpoint each participant points at; it adds the key and each model's request fields) and the fake provider, which answers any forced tool with arguments built from the tool's JSON schema.
- `server/`: HTTP and SSE. `GET /health`, `GET /events/telao` (the snapshot plus one row per model), `GET /api/models` (the Room's models, for assigning bonecos), `/api/admin/*` behind `Authorization: Bearer <FREVO_ADMIN_SECRET>` (`GET` and `POST /api/admin/models` with `{ model, enabled }`, `POST /api/admin/spending/reset`), and the built web for everything else.
- `gambi/`: the Room by name on the management plane, its inference events (`room-events.ts`, reconnecting) and the call on the inference plane.
- `testing/`: hub and child processes on free ports for tests, the smoke and `frevo:dev`.

The web keeps the data flow apart from the drawing: `telao/stream.ts` keeps the connection (and reconnects when the browser gives up or the stream goes silent), `telao/world-view.tsx` draws one snapshot and knows nothing else.

## Credits

The square is inspired by the World of [`gambiarraclub/gambiarra-arena`](https://github.com/gambiarraclub/gambiarra-arena) (MIT), by Filipe Calegario, and written from scratch here.
