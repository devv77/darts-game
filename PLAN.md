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

### Phase 4g — Live Score Preview on Numpad Input
- [ ] As the player types digits on the quick numpad (X01 mode), the scoreboard's remaining-score display updates in real time, showing `currentScore − enteredValue` before the throw is confirmed
- [ ] If the running subtotal would bust (go below 0, land on 1, or reach 0 without a valid double), display the bust state immediately (red tint / "BUST" label) so the player sees it before submitting
- [ ] Preview resets to the unmodified remaining score when the numpad input is cleared or cancelled
- [ ] Consistent with the existing mid-turn dart-by-dart recalculation (Phase 4f): both paths share the same `previewScore` derived state so the scoreboard component never needs separate logic per input mode
- [ ] No server call is made during the preview — purely client-side state in `X01Input` fed up to `GamePage` via a callback/context so `Scoreboard` can render the live value

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
- [x] Bull throw for starting order — pre-game UI shipped 2026-05-19 (`b90c961`)
- [ ] Dartboard SVG as input method
- [x] PWA support — site.webmanifest + maskable icons (2026-05-19) + service worker + offline app shell (`9332511`). Validate against Lighthouse on the next polish pass; "Add to Home Screen" prompt works on Android Chrome.
- [ ] Game history export (CSV)
- [ ] Head-to-head records in stats
- [ ] Practice mode (see `PRACTICE_MODE.md`)
- [ ] Tournament mode — knockout / league / groups→knockout (see `TOURNAMENT_MODE.md`)
- [ ] **H4 — Move auth token from localStorage to HttpOnly+Secure+SameSite=Lax cookie + CSRF token.** Defense-in-depth carry-over from the 2026-05-19 security audit (see `SECURITY_FINDINGS.md`). No XSS sink today (React JSX escaping verified), so deferred; revisit if anything ever introduces `dangerouslySetInnerHTML`, a markdown renderer, or third-party widgets that touch the DOM. Migration touches: server (set-cookie on `/api/auth/google`, clear on `/logout`, read cookie before falling back to bearer), web (drop localStorage token, use `credentials: 'include'` on fetch, switch socket.io to `withCredentials: true`), and CSRF (double-submit cookie on mutating routes — fastify-helmet + a CSRF middleware or `@fastify/csrf-protection`).

### Phase 8 — Online Multiplayer (planned)

**Goal:** play a leg/match with a remote friend — each player has their own device,
each enters their own throws, both see the scoreboard update in real time. The
current single-device flow stays available for in-person games.

**Foundation already in place:**
- Google Sign-In gates the app (Phase 7), so every player has a stable identity keyed
  on `google_id` + persistent `Player` row.
- Server-authoritative game state via `getFullGameState`; client only renders.
- Socket.IO rooms per game (`game:<id>`); broadcasts already fan out to every
  connected device joined to that room.

**The missing pieces are: turn arbitration, an invitation flow, and presence/UX
around "it's your turn vs. spectate."**

#### Open design decisions (resolve before writing code)

1. **Discovery: invite codes vs. friends list vs. both?**
   - *Code-only:* host shares a short URL like `darts.csodakucko.net/join/A4F2`; guest
     opens it (signed in), gets dropped into the game. No persistent friend graph.
     Minimal schema, fast to ship.
   - *Friends list:* `friends(player_id, friend_id, status)` table, invitations + accept
     handshake. Better UX for regulars, more code.
   - *Both:* friends for regulars, invite codes/links as the "stranger" path. Likely
     the right end state.
2. **Live-only or async-turn play?**
   - *Live:* both players online simultaneously, real-time. Simpler. What a pub night
     looks like.
   - *Async:* turns can be hours apart; server tracks `current_player_id` and pushes
     when it's your turn. Lets you finish a match across a workday but changes the
     UX significantly (timer/expiry rules, notifications, "abandoned game" cleanup).
   - Recommendation: live first, async as a follow-on.
3. **Notifications: web push, email, or in-app only?**
   - In-app-only is free but requires the app to be open.
   - Web Push (PWA + service worker + VAPID) gets "your turn" on the lock screen
     without a third-party push provider; blocks on PWA support landing first.
   - Email is dead-simple via a transactional sender; awkward for real-time.
4. **Cheat / dispute handling.** Honor system today (client reports darts, server
   trusts). For competitive remote play, the realistic options are: nothing (trust),
   require a photo of the board after a high score, or require both players to
   confirm a score before it locks. Probably "nothing" until someone complains.
5. **Spectator mode?** Trivial once room-based play exists — let any signed-in player
   join `game:<id>` read-only. Decide later whether spectator presence is shown to
   the players.

#### Phased rollout

**8a. Server-side turn gate + invite codes (MVP)** — ✅ DONE 2026-06-12
- [x] `games` gains `invite_code TEXT` (partial-unique index) + `is_online INTEGER NOT NULL DEFAULT 0`
  (live-online flag distinct from local pass-and-play); capacity stored as
  `settings.maxPlayers` (clamped 2–4).
- [x] On online game create: generate a 5-char code (alphabet excludes 0/O/1/I/L);
  the host creates with just themselves, AI is rejected in online games for now.
- [x] `POST /api/games/join { code }` → adds the caller to `game_players` if there's
  a free slot and the game hasn't started yet; idempotent for re-joins; 404 for
  unknown/non-online codes (no probing), 409 for full/started. Broadcasts the new
  roster to the room (`broadcastGameState` shared from the socket handler).
- [x] Turn ownership: `submit-turn` rejects unless `sessionPlayer.id === playerId`
  AND every seat is filled, but only for `is_online === 1`; single-device
  pass-and-play keeps the old any-participant-submits behaviour. Undo is gated to
  your own last turn client-side; server already restricts non-admin undo to own turn.
- [x] Frontend: Setup "Play online" toggle + capacity picker, Home "Join an online
  game" code form, GamePage "waiting for players (share code)" panel and "waiting
  for X to throw" state when it isn't your turn.
- [x] Tests: `apps/server/test/online.test.ts` (create validation + join flow, 13 cases).
- Deferred to later: surfacing the invite code on the lobby's resume card; bull-throw
  ordering for online (seat order is used in 8a).

**8b. Friends graph**
- `friends(player_id, friend_id, status TEXT)` where status ∈ `pending|accepted|blocked`.
- `POST /api/friends/invite { friend_id_or_email }`, `POST /api/friends/:id/accept`,
  `DELETE /api/friends/:id`.
- Lobby UI: friends list panel; "invite friend" picks from your accepted friends
  and posts an invite that shows up in their lobby (`pending_invites`).
- Online presence indicator (uses existing socket connections — `io.sockets.adapter.rooms`
  membership counts as "online").

**8c. Async play + web push (depends on PWA support)**
- Service worker registration + VAPID keys; one row per player in `push_subscriptions`.
- Server fires "your turn" push on every `current_player_id` change for online games.
- Game-level `last_action_at` + a cleanup job (cron via the existing
  `setTimeout`-based scheduler or a small background task) marks games abandoned
  after N hours.

**8d. Spectator mode**
- `spectators(game_id, player_id)` table or just allow `join-game` without a
  `game_players` row; server emits `game-state` but rejects `submit-turn`.
- Optional: render spectator presence in the UI.

#### Database changes (cumulative, additive only per CLAUDE.md migration policy)

```sql
-- 8a
ALTER TABLE games ADD COLUMN invite_code TEXT;
CREATE UNIQUE INDEX idx_games_invite_code ON games(invite_code) WHERE invite_code IS NOT NULL;
ALTER TABLE games ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0;

-- 8b
CREATE TABLE IF NOT EXISTS friends (
  player_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  friend_id  INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status     TEXT NOT NULL CHECK (status IN ('pending','accepted','blocked')),
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, friend_id)
);
CREATE INDEX idx_friends_status ON friends(status);

-- 8c
CREATE TABLE IF NOT EXISTS push_subscriptions (
  player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  p256dh_key  TEXT NOT NULL,
  auth_key    TEXT NOT NULL,
  created_at  TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (player_id, endpoint)
);
ALTER TABLE games ADD COLUMN last_action_at TEXT;
```

All gated behind a single `PRAGMA user_version` bump per phase (per the v1
pattern already in `db.ts`).

#### Socket events (additions)

- **Client → Server:** `subscribe-presence` (per-room), `unsubscribe-presence`
- **Server → Client:** `player-joined { playerId }`, `player-left { playerId }`,
  `invite-received { fromPlayerId, gameId? }` (8b),
  `your-turn { gameId }` (8c, in addition to push)

#### Risks / non-obvious gotchas

- **better-sqlite3 is single-process / single-DB.** Multi-instance Docker would
  break consistency. Stay single-instance until the workload demands sharding.
- **Socket reconnection during a turn.** Existing client already calls
  `join-game` on `connect`; need to verify the input pad remembers darts entered
  pre-disconnect (currently lives in component state and is lost on reload).
- **AI players + online games.** Phase 8 should disallow mixing AI and remote
  humans in the same game initially — the AI auto-turn lives server-side and
  doesn't care about device, so technically it works, but the UX of "you and a
  friend vs. AI Lv.5" needs a deliberate decision.
- **Authentik gate is off** (2026-05-19), so `darts.csodakucko.net` is reachable
  to anyone with a Google account. Phase 8b friends/invites should default to
  "private" — a stranger guessing an invite code should not be able to land in
  your game without an explicit accept step.

#### Out of scope for Phase 8

- WebRTC video feed (separate Phase 7 entry — see `REMOTE-PLAY.md` if it exists;
  online multiplayer here is *scoreboard sync only*, not live video). Could be
  layered on top later.
- ELO / matchmaking against random opponents.
- In-game chat. Voice/video covers it if 7's WebRTC ships; text chat seems like
  scope creep for darts.

### Phase 9 — Tournament Mode (T0 + T1 shipped 2026-06-12; T2–T5 planned)

Full design in **`TOURNAMENT_MODE.md`**. A meta-layer that orchestrates ordinary `games`
into a competition — single-elimination **knockout**, round-robin **league**, or
**groups → knockout** (user picks one per tournament). Humans + AI both enter.

Key decisions (resolved 2026-06-01):
- **All three formats**, independently selectable behind one shared shell.
- **Single-device pass-and-play first**, with schema/turn seams ready for online (T5 depends
  on Phase 8's turn-gate).
- **AI entrants allowed** — they auto-play via the existing `checkAndTriggerAiTurn`.

Architecture: each match is a real `games` row played through the audited socket engine; the
**only** edit to `socket-handler.ts` is one `onGameCompleted(gameId)` call after `winner_id`
is set, which settles the match and advances the format server-side. New standalone tables
(`tournaments`, `tournament_players`, `tournament_matches`), a pure `tournament-engine.ts`, a
`routes/tournaments.ts`, and a `TournamentPage` with Bracket / Table / Groups / Fixtures /
Champion views (Frontend Design Skill → "championship broadcast" direction).

Rollout status:
- [x] **T0 — Foundation & contract.** Tables + row types; `lib/tournaments.ts` contract;
  `tournament-engine.ts` knockout generator (+21 unit tests); `tournament-store.ts`;
  `onGameCompleted` seam + `tournament:<id>` room.
- [x] **T1 — Knockout end-to-end.** Routes (create/get/list/launch/delete, auth-scoped),
  Home tile + active strip, Setup knockout branch, `TournamentPage` Bracket + Fixtures +
  champion screen (live via sockets), GamePage "Back to Tournament". Single-device. 33 new
  server tests incl. a full create→launch→settle→advance→champion play-through.
- [x] **T2 — League** (2026-06-12). `generateRoundRobin` (circle method, single/double) +
  `computeStandings` (points → leg diff → legs for → seed; H2H deferred); format-aware
  store generate/settle; Table view + Matchday fixtures; online league supported too.
- [x] **T3 — Groups → Knockout** (2026-06-12). Snake-draft group draw, per-group
  round-robin, `seedKnockoutFromGroups` (cross-seeded, no same-group round-1 ties) that
  fires automatically once every group match settles; two-stage `tournament_matches.stage`
  (`group`→`ko`); Groups view (per-group mini-tables w/ qualify highlight) + stage-aware Fixtures.
- [ ] **T4 — AI polish.** "Simulate match" for all-AI fixtures; "sim to next human match".
- [x] **T5 — Online tournaments** (2026-06-12). `tournaments.invite_code` + `target_size`;
  setup-lobby → join-by-code → start (auto-starts when full, organiser can start early);
  launched matches are `is_online` games so the 8a turn-gate applies per device; launch gated
  to the match's two participants (or organiser). Home's one code box resolves game *or*
  tournament codes. Lock-screen "your match is ready" push still waits on Phase 8c; in-app live
  updates via the existing `tournament:<id>` socket room cover it for now.

Deferred within T1: the optional 3rd-place playoff (`options.thirdPlace`) — the schema only
wires the winner path, so a loser-path 3rd-place match is left for a follow-up; auto-seeding by
lifetime average (seeds currently follow roster selection order).
