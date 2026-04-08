# Darts Counter App

## Primary Directives
You are working on a self-hosted Darts Counter application. Check `PLAN.md` for phase/scope context before complex tasks.

## Tech Stack
- **Backend:** Node.js 20, Express 4.21, Socket.IO 4.8, better-sqlite3 (synchronous — do not wrap in async)
- **Frontend:** STRICTLY Vanilla HTML/CSS/JS. No React, Vue, or build steps. No CSS framework (PicoCSS was removed).
- **Database:** SQLite with WAL mode at `data/darts.db`
- **Deployment:** Docker (alpine), port 8080→3000 via docker-compose
- **Fonts:** Google Fonts — Oswald (display), Barlow/Barlow Condensed (body)

## Project Structure
```
server/
  index.js          — Express entry point (port 3000)
  db.js             — SQLite schema & initialization (handle migrations on startup)
  socket-handler.js — Game logic: turns, busts, wins, AI triggering
  ai-engine.js      — AI dart physics & strategy (10 levels)
  checkout-table.js — X01 checkout lookup
  routes/
    players.js      — CRUD /api/players
    games.js        — CRUD /api/games + getFullGameState()
    stats.js        — GET /api/stats/players/:id, /api/stats/games/:id
public/
  index.html        — Lobby page
  game.html         — Game page (body class="game-page")
  stats.html        — Stats page
  css/app.css       — All styles (no CSS framework)
  js/
    app.js          — API client, shared utils (parseDartScore, formatDart)
    lobby.js        — Player management, game creation, active games list
    scoreboard.js   — Renders score cards for x01 and cricket
    input-pad.js    — Dart-by-dart input (multiplier + number grid)
    x01-view.js     — 501/301 game view, numpad, quick input, checkout hints
    cricket-view.js — Cricket game view, marks grid, cricket input
    stats-view.js   — Stats page rendering
```

## Commands
- `npm start` — Start production server
- `npm run dev` — Start with `--watch` (auto-reload)
- `docker compose up -d --build` — Build & run in Docker
- Standard git commands are authorized

## Coding Standards
1. **Frontend Modularity:** Keep Vanilla JS organized per the structure above. All JS files share global scope (no modules). IDs for element lookup, classes for styling.
2. **Game Engines:** Keep game logic in socket-handler.js pure — takes inputs, applies rules, returns state.
3. **Database:** Handle schema migrations gracefully on startup in `db.js`.
4. **Socket Events:** Verify socket events map correctly between client and server.

## Key Architecture

### Game State Flow
1. Client emits `submit-turn` → server validates & persists to SQLite
2. Server broadcasts `game-state` to all clients in the game room
3. Server emits `game-over` when a win is detected
4. AI turns trigger automatically via `checkAndTriggerAiTurn()` with 1-3s delay

### Game Page Viewport
The game page (`body.game-page`) is locked to `100dvh` with `overflow: hidden` and flex layout to fit on mobile (Pixel 9: ~412x812 CSS px) without scrolling.

### Dart Notation
Darts encoded as strings: `S1`-`S20` (single), `D1`-`D20` (double), `T1`-`T20` (treble), `SB` (single bull/25), `DB` (double bull/50), `0` (miss).

### Socket.IO Events
- **Client → Server:** `join-game`, `submit-turn`, `undo-turn`
- **Server → Client:** `game-state`, `game-over`, `ai-thinking`

## Design
PDC broadcast-inspired dark theme:
- **Palette:** Deep navy (#0b0f19, #121828), red (#e53935) for accents, gold (#fbbf24) for active/CTAs, green (#22c55e) for confirm
- **Typography:** Oswald for scores/headings, Barlow Condensed for labels, Barlow for body
- **Layout:** Card-based, compact spacing for mobile

## Database Schema (5 tables)
- `players` — id, name (unique), avatar_color, is_ai, ai_level
- `games` — id, mode, status (in_progress/completed/abandoned), winner_id
- `game_players` — game_id, player_id, position (turn order)
- `turns` — game_id, player_id, round_num, dart1/2/3, score_total, is_bust
- `cricket_state` — game_id, player_id, marks_15..20, marks_bull, points

## Common Pitfalls
- The `hidden` HTML attribute needs `[hidden] { display: none !important }` in CSS — no framework provides this
- `showGameOver()` is called from both `game-over` socket event AND render functions — guard with `gameOverShown` flag
- Browser bfcache can restore stale page state — handle `pageshow` event
- Always rebuild Docker after changes: `docker compose up -d --build`

## Autonomous Workflow
When building a feature or phase:
1. **Review:** Check `PLAN.md` for scope
2. **Execute:** Write backend and frontend code
3. **Verify:** Check for unhandled exceptions, socket event mapping, DOM safety
4. **Deploy:** Rebuild Docker and verify
5. **Commit:** Always git commit after completing changes
6. **Update PLAN.md:** Tick off completed items or update if scope changed
