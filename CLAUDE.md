# Darts Counter App (v2)

## Primary Directives
You are working on a self-hosted Darts Counter web application. Check `PLAN.md` for phase/scope context before complex tasks.

## Tech Stack
- **Monorepo:** npm workspaces — `apps/server`, `apps/web`
- **Backend:** Node.js 20+, Fastify 5, Socket.IO 4, better-sqlite3 (synchronous — do not wrap in async), TypeScript (ESM)
- **Frontend:** React 18, Vite 5, TypeScript, react-router-dom 6, socket.io-client
- **UI libs:** GSAP (animations), canvas-confetti (180s/checkouts), Chart.js + chartjs-plugin-annotation + react-chartjs-2 (momentum graph)
- **Database:** SQLite with WAL mode at `data/darts.db` — same schema as v1, migrations idempotent on startup
- **Deployment:** Docker (multi-stage build) — Fastify serves the built React app from `apps/web/dist`
- **Fonts:** Google Fonts — Oswald (display), Barlow / Barlow Condensed (body)

## Project Structure
```
apps/
  server/                           # Fastify backend (TypeScript, ESM)
    src/
      index.ts                      # Fastify entry, registers routes + socket.io
      db.ts                         # SQLite connection, schema migrations, AI player seeding
      types.ts                      # Shared TS types (Game, Player, Turn, FullGameState…)
      darts.ts                      # parseDartScore, parseCricketDart
      checkout-table.ts             # 169-entry double-out lookup
      game-state.ts                 # getFullGameState() — aggregates game/players/turns/scores
      ai-engine.ts                  # 10-level AI dart physics + X01/cricket strategy
      socket-handler.ts             # join-game, submit-turn, undo-turn, AI triggering
      routes/
        players.ts                  # CRUD /api/players
        games.ts                    # CRUD /api/games
        stats.ts                    # /api/stats/players/:id, /api/stats/games/:id
        admin.ts                    # DELETE /api/admin/reset
    tsconfig.json
    package.json                    # @darts/server — tsx for dev, tsc → dist
  web/                              # React frontend (TypeScript, Vite)
    index.html
    vite.config.ts                  # Dev proxy: /api + /socket.io → :3000
    src/
      main.tsx                      # ReactDOM root + BrowserRouter
      App.tsx                       # <Routes>: /, /game, /stats
      types.ts                      # Shared client-side types (mirror of server)
      styles/app.css                # All styles (PDC dark theme; ~2200 lines)
      lib/
        api.ts                      # Typed fetch wrapper (get/post/put/del)
        darts.ts                    # parseDartScore, formatDart
        suggestions.ts              # Suggestion engine, checkout hints, bogey, presets
        socket.ts                   # Singleton socket.io-client
        animations.ts               # GSAP overlays, Web Audio tones, Web Speech voice
      hooks/
        useGame.ts                  # Subscribes to game-state/game-over/ai-thinking; submit/undo
      components/
        AppHeader.tsx               # Nav (Lobby / Stats)
        Scoreboard.tsx              # X01 + cricket scoreboard
        ThrowHistory.tsx            # Per-player last-3 throws
        SuggestionStrip.tsx         # Renders Suggestion
        X01Input.tsx                # Quick-input numpad + presets, toggles dart-by-dart
        DartByDartPad.tsx           # Multiplier + 1-20/Bull/Miss grid, mid-turn checkout
        CricketInput.tsx            # Cricket dart entry
        CricketGrid.tsx             # /, X, O marks grid + points row
        PostMatchReview.tsx         # Summary / Legs / Momentum tabs + rematch
      pages/
        Lobby.tsx                   # Players, mode/format pickers, active games
        GamePage.tsx                # Ties scoreboard + input + history + review
        Stats.tsx                   # Lifetime stats per human player
data/
  darts.db                          # SQLite (preserved across rebuilds via volume mount)
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
- **Client → Server:** `join-game { gameId }`, `submit-turn { gameId, playerId, darts?, scoreTotal? }`, `undo-turn { gameId }`
- **Server → Client:** `game-state` (full `FullGameState`), `game-over { winnerId }`, `ai-thinking { playerId }`

### Dev vs. Prod serving
- **Dev:** Vite serves the React app on `:5173` and proxies `/api/*` + `/socket.io/*` to Fastify on `:3000`.
- **Prod:** Fastify checks for `apps/web/dist/`; if present, registers `@fastify/static` with an SPA fallback (`setNotFoundHandler` → `index.html`) so client routes work.

## Design
PDC broadcast-inspired dark theme:
- **Palette:** Deep navy (`#0b0f19`, `#121828`), red (`#e53935`) for accents, gold (`#fbbf24`) for active player / CTAs, green (`#22c55e`) for confirm
- **Active player tint:** `--player-color` CSS variable is set from `GamePage.tsx` on every `game-state` update; the scoreboard, header border, and inputs follow it
- **Typography:** Oswald for scores/headings, Barlow Condensed for labels, Barlow for body
- **Layout:** Card-based, compact spacing for mobile

## Database Schema (5 tables — unchanged from v1)
- `players` — id, name (unique), avatar_color, is_ai, ai_level, created_at
- `games` — id, mode (`501` | `301` | `cricket`), status, winner_id, settings (JSON), created_at, finished_at
- `game_players` — game_id, player_id, position, sets_won, legs_won
- `turns` — game_id, player_id, round_num, set_num, leg_num, dart1/2/3, score_total, is_bust, created_at
- `cricket_state` — game_id, player_id, marks_15..20, marks_bull, points

## Common Pitfalls
- `better-sqlite3` is sync — **do not** `await` it; you'll silently get a Promise wrapping the row.
- The DB path resolves relative to the compiled `apps/server/dist/index.js`. Override via `DATA_DIR` env var (Docker sets this to `/app/data`).
- Server uses NodeNext ESM — when adding imports between server source files, **include the `.js` suffix** even though the source is `.ts`.
- Animations rely on `gsap` + `canvas-confetti` global side effects — they're imported as ES modules now (`import { gsap } from 'gsap'`), not via CDN scripts.
- Voice (Web Speech API) needs a one-time `initVoice()` call to pick a voice once `speechSynthesis.getVoices()` is populated; called from `GamePage`'s mount effect.
- Always rebuild Docker after changes: `docker compose up -d --build`.

## Autonomous Workflow
When building a feature or phase:
1. **Review:** Check `PLAN.md` for scope.
2. **Execute:** Write backend (TS) and frontend (React/TS) code. Add socket events on both sides in the same edit.
3. **Verify:** `npm run typecheck` (both workspaces); manually exercise the path (lobby → start game → throw → checkout → review).
4. **Deploy:** Rebuild Docker and verify on the target device.
5. **Commit:** Always git commit after completing changes.
6. **Update PLAN.md:** Tick off completed items or update if scope changed.
