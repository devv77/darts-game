# Darts Counter - Application Plan

A self-hosted web application for tracking darts games. Run it with `docker compose up` or `npm start` and open your browser.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Node.js 20 + Fastify 5 + Socket.IO 4 (TypeScript, ESM) | Fast HTTP, native schema-typed routes, mature WebSocket integration |
| Frontend | React 18 + Vite 5 + react-router-dom (TypeScript) | Component model fits the stateful game UI; Vite gives instant HMR |
| Bundler / Dev proxy | Vite | `/api` + `/socket.io` proxied to Fastify in dev |
| Animations / FX | GSAP, canvas-confetti, Chart.js (+annotation plugin) | Same FX layer as v1; now imported as ES modules |
| Database | SQLite (better-sqlite3, sync) | Zero config, single file, no external service |
| Deployment | Multi-stage Docker (alpine) | One image, Fastify serves built React from `apps/web/dist` |
| CI | Forgejo Actions (`.forgejo/workflows/build-push.yml`) | Builds + pushes to internal registry on push to main |

Monorepo: npm workspaces (`apps/server`, `apps/web`).

---

## Game Modes

### 501 / 301 (x01)

- Players start at 501 or 301 and subtract each turn (3 darts per turn)
- **Bust rule**: Turn is voided if score goes below 0, lands on 1, or reaches 0 without a double as the final dart
- **Checkout suggestions**: When remaining score is 170 or below, show the optimal finish (e.g. T20-T20-D20 for 170)
- **Stats**: 3-dart average, first-9 average, highest turn, 180s count, 140+ count, checkout percentage

### Cricket

- Target numbers: 15, 16, 17, 18, 19, 20, Bullseye
- Hit a number 3 times to "close" it (single=1 mark, double=2, treble=3)
- Once closed, additional hits score points (number value, bull=25) — only if opponent hasn't closed it
- **Win condition**: Close all 7 numbers AND have equal or more points than all opponents
- **Display**: Mark grid showing `/`, `X`, `O` for 1, 2, 3 marks per player

---

## User Management

Simple player profiles — no authentication:
- Create player with name and avatar color
- Players are selected when creating a game (2-4 players)
- Lifetime stats tracked per player
- AI opponents with 10 difficulty levels (Beginner to World Class)

---

## Architecture

```
darts-game/
├── Dockerfile                          # Multi-stage build
├── docker-compose.yml
├── .dockerignore
├── .gitignore
├── PLAN.md                             # This file
├── CLAUDE.md
├── README.md
├── STATUS.md
├── package.json                        # Workspace root
├── tsconfig.base.json
├── .forgejo/
│   └── workflows/
│       └── build-push.yml              # CI: build + push image on main
├── apps/
│   ├── server/                         # Fastify + TS (ESM)
│   │   ├── package.json                # @darts/server
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts                # Fastify entry, registers routes + Socket.IO
│   │       ├── db.ts                   # SQLite connection, schema migrations, AI seeding
│   │       ├── types.ts                # Shared types (Game, Player, Turn, FullGameState…)
│   │       ├── darts.ts                # parseDartScore, parseCricketDart
│   │       ├── checkout-table.ts       # 169-entry double-out lookup
│   │       ├── game-state.ts           # getFullGameState() aggregator
│   │       ├── ai-engine.ts            # 10-level AI dart physics + strategy
│   │       ├── socket-handler.ts       # join-game, submit-turn, undo-turn, AI triggering
│   │       └── routes/
│   │           ├── players.ts          # CRUD /api/players
│   │           ├── games.ts            # CRUD /api/games
│   │           ├── stats.ts            # /api/stats/players/:id, /api/stats/games/:id
│   │           └── admin.ts            # DELETE /api/admin/reset
│   └── web/                            # React + Vite + TS
│       ├── package.json                # @darts/web
│       ├── vite.config.ts              # Dev proxy: /api + /socket.io → :3000
│       ├── index.html
│       ├── tsconfig.json, tsconfig.app.json, tsconfig.node.json
│       └── src/
│           ├── main.tsx                # ReactDOM root + BrowserRouter
│           ├── App.tsx                 # Routes: / /game /stats
│           ├── types.ts                # Client-side mirror of server types
│           ├── styles/app.css          # All styles (~2200 lines, PDC dark theme)
│           ├── lib/
│           │   ├── api.ts              # Typed fetch wrapper
│           │   ├── darts.ts            # parseDartScore, formatDart
│           │   ├── suggestions.ts      # Suggestion engine, checkout hints, bogey, presets
│           │   ├── socket.ts           # Singleton socket.io-client
│           │   └── animations.ts       # GSAP overlays, Web Audio, Web Speech
│           ├── hooks/
│           │   └── useGame.ts          # game-state / game-over / ai-thinking subscription
│           ├── components/
│           │   ├── AppHeader.tsx
│           │   ├── Scoreboard.tsx      # X01 + cricket
│           │   ├── ThrowHistory.tsx
│           │   ├── SuggestionStrip.tsx
│           │   ├── X01Input.tsx        # Quick numpad + presets
│           │   ├── DartByDartPad.tsx   # Multiplier + 1-20/Bull/Miss grid
│           │   ├── CricketInput.tsx
│           │   ├── CricketGrid.tsx
│           │   └── PostMatchReview.tsx # Summary / Legs / Momentum tabs
│           └── pages/
│               ├── Lobby.tsx
│               ├── GamePage.tsx
│               └── Stats.tsx
└── data/                               # SQLite (volume-mounted in Docker)
    └── darts.db
```

---

## Data Model

### players
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT UNIQUE | Player display name |
| avatar_color | TEXT | Hex color (default `#3b82f6`) |
| is_ai | INTEGER | 0 or 1 |
| ai_level | INTEGER | 1-10 (null for human) |
| created_at | TEXT | ISO datetime |

### games
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| mode | TEXT | `501`, `301`, or `cricket` |
| status | TEXT | `in_progress`, `completed`, `abandoned` |
| winner_id | INTEGER FK | References `players.id` |
| settings | TEXT | JSON (`{ format, bestOfLegs, bestOfSets, bestOfLegsPerSet }`) |
| created_at | TEXT | ISO datetime |
| finished_at | TEXT | ISO datetime |

### game_players
| Column | Type | Notes |
|--------|------|-------|
| game_id | INTEGER FK | References `games.id` |
| player_id | INTEGER FK | References `players.id` |
| position | INTEGER | Turn order (0, 1, 2…) |
| sets_won | INTEGER | Sets won this match |
| legs_won | INTEGER | Legs won in current set |

### turns
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| game_id | INTEGER FK | References `games.id` |
| player_id | INTEGER FK | References `players.id` |
| round_num | INTEGER | 1-based round number |
| set_num | INTEGER | 1-based set number |
| leg_num | INTEGER | 1-based leg-within-set |
| dart1 | TEXT | Encoded — see below |
| dart2 | TEXT | Same encoding |
| dart3 | TEXT | Same encoding |
| score_total | INTEGER | Computed points for this turn |
| is_bust | INTEGER | 1 if busted (x01 only) |
| created_at | TEXT | ISO datetime |

**Dart encoding**: `S1`-`S20` (single), `D1`-`D20` (double), `T1`-`T20` (treble), `SB` (single bull 25), `DB` (double bull 50), `0` (miss)

### cricket_state
| Column | Type | Notes |
|--------|------|-------|
| game_id | INTEGER FK | References `games.id` |
| player_id | INTEGER FK | References `players.id` |
| marks_15 - marks_20 | INTEGER | 0-3+ marks per number |
| marks_bull | INTEGER | 0-3+ marks on bull |
| points | INTEGER | Running point total |

Migrations are additive (`CREATE IF NOT EXISTS`, `ALTER … ADD COLUMN` wrapped in try/catch) and re-run on every server start — safe to point the new build at the existing `data/darts.db`.

---

## API Endpoints

### REST (prefix: `/api`)

**Players**
- `GET /api/players` — List all players
- `POST /api/players` — Create player `{ name, avatar_color, is_ai, ai_level }`
- `PUT /api/players/:id` — Update player
- `DELETE /api/players/:id` — Delete player (blocked if has active games)

**Games**
- `GET /api/games` — List games (filter by `?status=`)
- `POST /api/games` — Create game `{ mode, player_ids, settings }`
- `GET /api/games/:id` — Full aggregated game state
- `DELETE /api/games/:id` — Abandon / delete game (cascade)

**Stats**
- `GET /api/stats/players/:id` — Player lifetime stats
- `GET /api/stats/games/:id` — Per-game and per-leg breakdown

**Admin**
- `DELETE /api/admin/reset` — Wipe non-AI players and all game data (dev convenience)

### Socket.IO Events

**Client emits:**
- `join-game { gameId }` — Join game room
- `submit-turn { gameId, playerId, darts, scoreTotal }` — Submit turn
- `undo-turn { gameId }` — Undo last turn

**Server emits (to `game:<id>`):**
- `game-state { ...FullGameState }` — After every state change
- `game-over { winnerId }` — Game finished
- `ai-thinking { playerId }` — AI is calculating

---

## UI Screens

### 1. Lobby (`/`)
- Add/remove human players (colored badges) + pick AI opponent
- "New Game": mode (501/301/Cricket), match format, select players
- Active games list with resume / abandon

### 2. Active Game — x01 (`/game?id=…`)
- **Top**: Scoreboard with remaining score, sets/legs badges, dart icon for starting player, active player tinted via `--player-color`
- **Middle**: Throw history (last 3 turns per player), dynamic suggestion strip (scoring / setup / checkout / safety colors)
- **Bottom**: Input area with two modes:
  - **Quick numpad**: Skill-tier preset buttons + digit pad + bogey warning
  - **Dart-by-dart**: Multiplier toggle + 1-20/Bull/Miss grid + mid-turn checkout recalculation

### 3. Active Game — Cricket
- **Top**: Player scoreboard with point totals
- **Middle**: Marks grid (20, 19, 18, 17, 16, 15, Bull) with `/`, `X`, `O` per player + points row
- **Bottom**: Number + multiplier input

### 4. Post-Match Review (overlay on game completion)
- Winner banner with trophy
- Three tabs: **Summary**, **Legs** (multi-leg matches only), **Momentum** (Chart.js with 180/ton/bust/checkout annotations)
- Rematch (same players + settings) / Back to Lobby

### 5. Stats (`/stats`)
- Per-player lifetime stats: games/wins/win rate, X01 averages, score milestones, cricket section

**Design**: Mobile-first (Pixel 9 viewport), portrait primary, large touch targets, dark PDC-broadcast theme. Game page locked to `100dvh` (`body.game-page` class added via React `useEffect`).

---

## Deployment

### Docker (local)
```yaml
# docker-compose.yml
services:
  darts:
    build: .
    ports:
      - "8080:3000"
    volumes:
      - darts-data:/app/data
    restart: unless-stopped

volumes:
  darts-data:
```

`docker compose up -d --build` → open `http://localhost:8080`.

### Docker (CI-built image)
`.forgejo/workflows/build-push.yml` builds on every push to `main` and tags `forgejo.csodakucko.net/lendev/darts-game:<short-sha>` + `:latest`. The consumer compose file can replace `build: .` with `image: forgejo.csodakucko.net/lendev/darts-game:latest` to pull from the registry.

### Local dev
```bash
npm install
npm run dev          # server :3000 + Vite :5173 in parallel
```

---

## Implementation Phases

### Phase 1 — Skeleton ✅
- [x] Project init, folder structure
- [x] Express server serving static files (v1)
- [x] SQLite setup with schema migrations on startup
- [x] Lobby page: player CRUD
- [x] Docker setup

### Phase 2 — 501 Game Mode ✅
- [x] x01 scoring, bust detection, double-out validation, win detection
- [x] Checkout table (static lookup for scores 2-170)
- [x] Game creation + turn submission APIs
- [x] Socket.IO: room management, state broadcast
- [x] x01 game UI: scoreboard, quick numpad input, checkout suggestions
- [x] Undo functionality

### Phase 3 — Cricket Game Mode ✅
- [x] Cricket marks tracking, point scoring, close detection, win condition
- [x] Cricket state persistence
- [x] Cricket UI: marks grid, number input
- [x] Reuse socket infrastructure from Phase 2

### Phase 4 — Stats & Polish ✅
- [x] Stats aggregation queries
- [x] Stats page UI
- [x] Game over overlay with rematch
- [x] Dart-by-dart input mode for x01
- [x] AI opponents (10 levels)
- [x] Professional UI redesign (PDC broadcast theme)
- [x] Mobile viewport optimization

### Phase 4b — Enhanced Stats ✅
- [x] Filter AI players from stats page
- [x] 3-dart average and first-9 average
- [x] Best leg (fewest darts to win)
- [x] Score milestones: 180s, 140+, 100+
- [x] Checkout percentage, bust rate
- [x] Cricket stats section
- [x] Grouped stats layout

### Phase 4c — Sets & Legs ✅
- [x] Schema: sets_won/legs_won, set_num/leg_num
- [x] Format settings JSON (single / legs / sets)
- [x] Leg win → increment legs_won; set win → increment sets_won + reset legs
- [x] Score reset per leg
- [x] Starting player rotation per leg
- [x] Lobby UI: match format selector
- [x] Scoreboard: sets/legs badges, starting-player dart icon
- [x] Game header shows format (e.g. "501 Bo5")
- [x] Rematch carries forward settings

### Phase 4d — Dynamic Throw Suggestions ✅
- [x] Skill-tier engine (beginner / club / good / advanced)
- [x] Scoring / setup / checkout / safety phases
- [x] Color-coded suggestion strip
- [x] Cached player stats client-side
- [x] First-9 hints in opening rounds, post-bust nudge

### Phase 4e — Bogey Numbers ✅
- [x] Bogey array: 169, 168, 166, 165, 163, 162, 159
- [x] Numpad + dart-by-dart warnings
- [x] Visual flash on input area

### Phase 4f — Mid-Turn Recalculation ✅
- [x] Suggestion strip updates after each dart
- [x] Recalculates checkout from running subtotal
- [x] "Game shot!" / "BUST" feedback

### Phase 5a — Post-Match Review ✅
- [x] Three-tab review overlay (Summary, Legs, Momentum)
- [x] Per-player overall stats
- [x] Per-leg breakdown table
- [x] Chart.js momentum graph with 180/ton/bust/checkout annotations
- [x] Rematch + Back to Lobby actions
- [x] Stats API returns leg-by-leg breakdown

### Phase 6 — v2 Rewrite (Fastify + React + TypeScript) ✅
Full overhaul of the stack with all gameplay features preserved 1:1. Express → Fastify, vanilla JS → React, JavaScript → TypeScript end-to-end, npm workspaces monorepo.

- [x] Backend ported to Fastify 5 + TypeScript (ESM)
  - [x] Routes: players, games, stats, admin
  - [x] Socket handler (join / submit-turn / undo / AI triggering)
  - [x] AI engine (10 levels, X01 + Cricket strategy)
  - [x] Checkout table, dart-score parsing, game-state aggregator
  - [x] DB module preserves v1 schema; migrations remain idempotent
- [x] Frontend ported to React 18 + Vite + TypeScript
  - [x] React Router (lobby / game / stats)
  - [x] Custom `useGame` hook for socket subscription
  - [x] Component-per-screen: Scoreboard, ThrowHistory, SuggestionStrip, X01Input + DartByDartPad, CricketInput, CricketGrid, PostMatchReview
  - [x] Animations / sound / voice module
  - [x] Chart.js momentum graph via react-chartjs-2
  - [x] PDC dark-theme CSS copied verbatim
- [x] Multi-stage Dockerfile (builder → alpine runtime, native better-sqlite3 build tools added/removed in a single layer)
- [x] Forgejo Actions CI (`build-push.yml`) — builds + pushes image on every push to main
- [x] CLAUDE.md, README.md, PLAN.md updated for the new stack

### Phase 7 — Future Enhancements
- [x] Google Account authentication (see `GOOGLE-AUTH-SETUP.md`):
  - Backend: `auth.ts` module (token verify, session create/lookup, admin gate), `/api/auth/{config,google,me,logout}` routes, global REST preHandler requires session, Socket.IO handshake validates session, `DELETE /api/admin/reset` is admin-only, destructive one-shot migration wipes pre-Google local players + games on first boot
  - Frontend: AuthProvider + `useAuth`, `SignIn` page renders Google Identity Services button, `/api/auth/config` drives runtime client-ID config, auth-gated routes, header avatar + sign-out, profile pictures via `<PlayerAvatar>` (preserves accent colors for both Google and AI players)
  - Env: `GOOGLE_CLIENT_ID` + `ADMIN_EMAILS` wired into docker-compose; `.env.example` added
  - **Follow-up to drop Authentik gate**: flip `vps_proxied_services` entry for `darts.csodakucko.net` from `authentik: true → false`, delete the Authentik proxy provider + application, then `docs/STATUS.md` can mention native auth (homelab `TODO.md` cleanup)
  - **Known scope cut**: multi-human-on-one-device flow still requires sign out → sign in as the other player; no in-app "add another Google player" yet
- [ ] Remote Play via WebRTC — peer-to-peer video feed with synced scoreboard, Socket.IO as signaling server, Cloudflare Tunnel for internet exposure (see `REMOTE-PLAY.md`)
- [x] Animation overlays — GSAP + canvas-confetti
- [x] Sound effects — Web Audio API
- [x] Voice announcements — Web Speech API
- [x] CI/CD — Forgejo Actions Docker build + push
- [ ] Bull throw for starting order
- [ ] Dartboard SVG as input method
- [ ] PWA support (offline, "Add to Home Screen")
- [ ] Game history export (CSV)
- [ ] Head-to-head records in stats
- [ ] Practice mode (see `PRACTICE_MODE.md`)
- [ ] Tournament brackets
