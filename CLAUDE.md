# Darts Counter App (v2)

## Primary Directives
You are working on a self-hosted Darts Counter web application. Check `PLAN.md` for phase/scope context before complex tasks.

## Tech Stack
- **Monorepo:** npm workspaces — `apps/server`, `apps/web`
- **Backend:** Node.js 20+, Fastify 5, Socket.IO 4, better-sqlite3 (synchronous — do not wrap in async), TypeScript (ESM)
- **Frontend:** React 18, Vite 5, TypeScript, react-router-dom 6, socket.io-client
- **UI libs:** GSAP (animations), canvas-confetti (180s/checkouts), Chart.js + chartjs-plugin-annotation + react-chartjs-2 (momentum graph)
- **Database:** SQLite with WAL mode at `data/darts.db` — 13 tables; additive, idempotent migrations on startup (`CREATE IF NOT EXISTS` + guarded `ALTER`)
- **Auth:** Google Sign-In (`google-auth-library`) with a passwordless local-account fallback when no Google client is configured
- **Deploy:** Forgejo Actions `build-push.yml` → image to the internal registry; rolled to LXC 208 via Renovate digest bump → `deploy-docker-app.yml` (homelab repo)
- **Deployment:** Docker (multi-stage build) — Fastify serves the built React app from `apps/web/dist`
- **Fonts:** Google Fonts — Oswald (display), Barlow / Barlow Condensed (body)

## Project Structure
```
apps/
  server/                           # Fastify backend (TypeScript, ESM)
    src/
      index.ts                      # Process entry: buildApp(), serve SPA in prod, attach socket.io, listen
      app.ts                        # buildApp() — helmet/CORS/rate-limit, /api auth preHandler, /api/health, route registration, @fastify/multipart
      auth.ts                       # Google + local sign-in, sessions, isAdmin (ADMIN_EMAILS + local-admin + players.is_admin), guards
      sanitize.ts                   # Strip email/google_id PII from player payloads (REST + socket)
      db.ts                         # SQLite connection, schema + additive migrations, AI seeding; exports DATA_DIR
      types.ts                      # Shared TS types (Game, Player, Turn, FullGameState, Tournament*, …)
      darts.ts                      # parseDartScore, parseCricketDart, isValidDart
      checkout-table.ts             # 169-entry double-out lookup
      game-state.ts                 # getFullGameState() — aggregates game/players/turns/scores (+ tournament link)
      ai-engine.ts                  # 10-level AI dart physics + X01/cricket strategy
      practice-engine.ts            # Pure practice-drill logic
      tournament-engine.ts          # Pure: generateKnockout / generateRoundRobin / computeStandings / groups
      tournament-store.ts           # Tournament DB layer; settleCompletedGame (the onGameCompleted seam), simulateAiGame
      push.ts                       # web-push (VAPID) subscriptions + sendPushToPlayer
      socket-handler.ts             # join-game/submit-turn/undo-turn, join/leave-tournament, AI triggering, presence, onGameCompleted seam
      routes/
        auth.ts                     # /api/auth/{config,google,local,me,logout}
        players.ts                  # CRUD /api/players + avatar upload/serve + admin toggle
        games.ts                    # CRUD /api/games + /api/games/join (online)
        stats.ts                    # /api/stats/players/:id, /api/stats/games/:id
        practice.ts                 # /api/practice lifecycle
        tournaments.ts              # /api/tournaments CRUD + match launch/simulate + join/start
        friends.ts                  # /api/friends list/invite/accept/remove
        push.ts                     # /api/push/{vapid,subscribe,unsubscribe}
        admin.ts                    # DELETE /api/admin/reset
    tsconfig.json
    package.json                    # @darts/server — tsx for dev, tsc → dist
  web/                              # React frontend (TypeScript, Vite + vite-plugin-pwa)
    index.html
    vite.config.ts                  # Dev proxy /api + /socket.io → :3000; PWA (Workbox + push-sw.js); __APP_VERSION__ define
    public/push-sw.js               # Custom push + notificationclick handlers (imported into the Workbox SW)
    src/
      main.tsx                      # ReactDOM root + BrowserRouter + AuthProvider
      App.tsx                       # Auth-gated <Routes>: / /setup /game /practice /tournament /friends /profile /stats /admin /health
      types.ts                      # Shared client-side types (mirror of server)
      vite-env.d.ts                 # declares __APP_VERSION__ (baked git SHA)
      styles/app.css                # All styles (PDC dark theme)
      contexts/AuthContext.tsx      # AuthProvider/useAuth — Google + local sign-in, /me rehydrate, isAdmin
      lib/                          # api (get/post/put/del/upload), auth, darts, suggestions, modes, practice,
                                    # tournaments, friends, push, health, bull-throw, socket, animations
      hooks/useGame.ts              # Subscribes to game-state/game-over/ai-thinking; submit/undo
      components/                   # AppHeader, Scoreboard, ThrowHistory, SuggestionStrip, X01Input, DartByDartPad,
                                    # CricketInput, CricketGrid, PracticeDartPad, PostMatchReview, ModeTile,
                                    # PlayerSelectGrid, AddPlayerInline, PlayerAvatar, BullThrow, UpdatePrompt, TestModeBadge
      pages/                        # SignIn, Home, Setup, GamePage, PracticePage, TournamentPage, Friends,
                                    # Profile, Stats, Admin, Health
data/
  darts.db                          # SQLite (preserved across rebuilds via volume mount)
  avatars/                          # uploaded profile pictures (<playerId>.<ext>)
```

## Commands
Run from the **repo root** unless noted.

- `npm install` — install workspace deps (first run rebuilds `better-sqlite3` native)
- `npm run dev` — runs server (`tsx watch`) on `:3000` and Vite dev server on `:5173` in parallel; open `http://localhost:5173`
- `npm run dev:server` / `npm run dev:web` — start one side only
- `npm run build` — builds both workspaces (`apps/server/dist`, `apps/web/dist`)
- `npm start` — runs the compiled server (`node apps/server/dist/index.js`); serves the built web app at the same port
- `npm run typecheck` — type-check all workspaces
- `docker compose up -d --build` — build & run in Docker (port `8080 → 3000`)
- Standard git commands are authorized.

## Coding Standards
1. **TypeScript everywhere.** Strict mode is on; prefer narrow types over `any`. Server uses NodeNext ESM imports with `.js` suffix.
2. **Game engines are server-authoritative.** All rule enforcement (busts, leg/set transitions, cricket scoring) lives in `apps/server/src/socket-handler.ts` and `game-state.ts`. The client renders; it does not decide.
3. **Database access is synchronous** — `better-sqlite3` is sync; do not wrap in promises. Use `db.transaction(() => …)()` for multi-statement atomicity.
4. **Schema migrations on startup** — additive only (`CREATE IF NOT EXISTS`, `ALTER … ADD COLUMN` wrapped in try/catch). Never destructive at boot.
5. **Socket events** must match exactly between `socket-handler.ts` and `useGame.ts`. Add new events to both sides in the same commit.
6. **CSS lives in one file** (`apps/web/src/styles/app.css`). Page-specific layout (e.g. `body.game-page` 100dvh lock) is gated by adding the class to `document.body` from the relevant page's `useEffect`.
7. **No comments unless WHY is non-obvious.** Don't restate what code does.

## Key Architecture

### Game State Flow
1. Client emits `submit-turn` over Socket.IO → server validates, persists turn row, updates `cricket_state` / `game_players` legs/sets as needed.
2. Server broadcasts `game-state` (the full aggregated state from `getFullGameState`) to all sockets in `game:<id>`.
3. On win, server flips `games.status = 'completed'`, sets `winner_id`, and emits `game-over { winnerId }`.
4. After every turn the server calls `checkAndTriggerAiTurn`, which emits `ai-thinking` and schedules an AI turn 1–3s later via `setTimeout`. A `Set` guards against duplicate triggers per game.

### Game Page Viewport
`body.game-page` (added via `useEffect` in `GamePage.tsx`) locks to `100dvh` with `overflow: hidden` and a flex column layout so the game fits a phone (~412×812 CSS px) without scrolling. The cleanup removes the class on unmount.

### Dart Notation
Darts encoded as strings: `S1`–`S20` (single), `D1`–`D20` (double), `T1`–`T20` (treble), `SB` (single bull / 25), `DB` (double bull / 50), `0` (miss).

### Socket.IO Events
- **Client → Server:** `join-game { gameId }`, `submit-turn { gameId, playerId, darts?, scoreTotal? }`, `undo-turn { gameId }`, `join-tournament { tournamentId }`, `leave-tournament { tournamentId }`
- **Server → Client:** `game-state` (full `FullGameState`), `game-over { winnerId }`, `ai-thinking { playerId }`, `tournament-updated { tournamentId }`
- Handshake auth: socket middleware validates the session token; `submit-turn`/`undo-turn` require participation. Online games (`is_online=1`) additionally gate `submit-turn` to the current player on their own device. `join-game` is read-only-open (spectators). Per-player presence is tracked from live socket connections.

### Dev vs. Prod serving
- **Dev:** Vite serves the React app on `:5173` and proxies `/api/*` + `/socket.io/*` to Fastify on `:3000`.
- **Prod:** Fastify checks for `apps/web/dist/`; if present, registers `@fastify/static` with an SPA fallback (`setNotFoundHandler` → `index.html`) so client routes work.

## Design
PDC broadcast-inspired dark theme:
- **Palette:** Deep navy (`#0b0f19`, `#121828`), red (`#e53935`) for accents, gold (`#fbbf24`) for active player / CTAs, green (`#22c55e`) for confirm
- **Active player tint:** `--player-color` CSS variable is set from `GamePage.tsx` on every `game-state` update; the scoreboard, header border, and inputs follow it
- **Typography:** Oswald for scores/headings, Barlow Condensed for labels, Barlow for body
- **Layout:** Card-based, compact spacing for mobile

## Database Schema (13 tables; additive migrations on boot)
Core (X01/cricket):
- `players` — id, name (unique), avatar_color, is_ai, ai_level, **google_id, email, avatar_url, is_admin**, created_at
- `games` — id, mode (`501` | `301` | `cricket`), status, winner_id, settings (JSON), **invite_code, is_online**, created_at, finished_at
- `game_players` — game_id, player_id, position, sets_won, legs_won
- `turns` — game_id, player_id, round_num, set_num, leg_num, dart1/2/3, score_total, is_bust, cricket_points, created_at
- `cricket_state` — game_id, player_id, marks_15..20, marks_bull, points

Auth / practice / social:
- `sessions` — token, player_id, created_at, expires_at
- `practice_sessions`, `practice_history` — solo drill state + metrics
- `friends` — player_id, friend_id, status (`pending|accepted|blocked`)
- `push_subscriptions` — player_id, endpoint, p256dh_key, auth_key (web push)

Tournaments (Phase 9):
- `tournaments` — name, format (`knockout|league|groups_knockout`), mode, match_settings, options, status, is_online, invite_code, target_size, winner_id, created_by
- `tournament_players` — tournament_id, player_id, seed, group_label, eliminated
- `tournament_matches` — tournament_id, game_id, stage (`group|ko|league`), round_num, match_index, home/away_player_id, home/away_legs, winner_id, status, next_match_id, next_slot

## Common Pitfalls
- `better-sqlite3` is sync — **do not** `await` it; you'll silently get a Promise wrapping the row.
- The DB path resolves relative to the compiled `apps/server/dist/index.js`. Override via `DATA_DIR` env var (Docker sets this to `/app/data`).
- Server uses NodeNext ESM — when adding imports between server source files, **include the `.js` suffix** even though the source is `.ts`.
- Animations rely on `gsap` + `canvas-confetti` global side effects — they're imported as ES modules now (`import { gsap } from 'gsap'`), not via CDN scripts.
- Voice (Web Speech API) needs a one-time `initVoice()` call to pick a voice once `speechSynthesis.getVoices()` is populated; called from `GamePage`'s mount effect.
- Always rebuild Docker after changes: `docker compose up -d --build`.

## Autonomous Workflow
When building a feature or phase:
1. **Review:** Check `PLAN.md` (scope) + `STATUS.md` (current shipped state — canonical).
2. **Execute:** Write backend (TS) and frontend (React/TS) code. Add socket events on both sides in the same edit.
3. **Verify:** `npm run build` (runs the vitest gate, both workspaces) must be green; run `npm run test:e2e` if UI/flow changed.
4. **Commit + push to `main`** (Forgejo `origin`, mirrors to GitHub). This is also the deploy trigger.
5. **Deploy (homelab):** push to `main` → Forgejo Actions `build-push.yml` builds + pushes the image (`:sha` + `:latest`) to the registry. The LXC 208 compose **pins a digest**, so the live rollout happens when **Renovate** bumps that digest in the **homelab** repo → `deploy-docker-app.yml`. To force it now: bump the pinned digest in `homelab:docker-apps/darts-game/docker-compose.yml` and push. Verify with `GET /api/health` (`version` = git short SHA).
6. **Update docs:** keep `STATUS.md` + `PLAN.md` current with what shipped.
