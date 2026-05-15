# Darts Counter — Project Status

Last updated: 2026-05-16 (v2 — Fastify + React + TS rewrite)

---

## Codebase Overview

| Category | Files | Notes |
|----------|-------|-------|
| Server TypeScript | 10 | `apps/server/src/**.ts` — Fastify, sockets, AI, DB, routes |
| Frontend TypeScript / TSX | 19 | `apps/web/src/**.{ts,tsx}` — React app, components, hooks, libs |
| CSS | 1 | `apps/web/src/styles/app.css` (~2200 lines, PDC dark theme) |
| Docker | 2 | `Dockerfile` (multi-stage), `docker-compose.yml` |
| CI | 1 | `.forgejo/workflows/build-push.yml` |

**Stack:** Node.js 20 + Fastify 5 + Socket.IO 4 + better-sqlite3 (server) — React 18 + Vite 5 + react-router-dom + socket.io-client (web) — all TypeScript, ESM, npm workspaces monorepo.

**External libs at runtime:** GSAP (animations), canvas-confetti (180s/checkouts), Chart.js + chartjs-plugin-annotation + react-chartjs-2 (momentum graph), Google Fonts (Oswald, Barlow, Barlow Condensed).

---

## Server (apps/server/src/)

| File | Purpose |
|------|---------|
| `index.ts` | Fastify entry — registers CORS, routes, static SPA serving (prod), then attaches Socket.IO to the underlying HTTP server |
| `db.ts` | better-sqlite3 connection, WAL mode, schema migrations (idempotent), AI player seeding |
| `types.ts` | Shared TS types: `Player`, `Game`, `Turn`, `CricketState`, `MatchSettings`, `FullGameState` |
| `darts.ts` | `parseDartScore`, `parseCricketDart` |
| `checkout-table.ts` | 169-entry double-out lookup (2 → 170) |
| `game-state.ts` | `getFullGameState(gameId)` — single aggregator: players, turns, scores, set/leg tracking, current player index |
| `ai-engine.ts` | 10-level dart-physics simulator + X01 / cricket strategy |
| `socket-handler.ts` | `join-game`, `submit-turn`, `undo-turn` handlers; turn validation; bust + leg/set transitions; AI triggering (1–3 s delay, dedup guard) |
| `routes/players.ts` | CRUD `/api/players` |
| `routes/games.ts` | CRUD `/api/games`, returns full state from `getFullGameState` |
| `routes/stats.ts` | `/api/stats/players/:id`, `/api/stats/games/:id` (with leg-by-leg breakdown) |
| `routes/admin.ts` | `DELETE /api/admin/reset` — wipes non-AI players and all game data |

---

## Frontend (apps/web/src/)

### Entry
- `main.tsx` — ReactDOM root + `BrowserRouter`
- `App.tsx` — Routes: `/`, `/game`, `/stats`

### Pages
- `pages/Lobby.tsx` — player management, mode/format pickers, active game list
- `pages/GamePage.tsx` — owns the live game; wires `useGame`, presets, suggestion, animations, voice, wake-lock, post-match overlay
- `pages/Stats.tsx` — per-human-player lifetime stats

### Hooks
- `hooks/useGame.ts` — subscribes to `game-state`, `game-over`, `ai-thinking`; exposes `submitTurn`, `undoTurn`; triggers throw animations on new turns

### Libraries
- `lib/api.ts` — typed `fetch` wrapper (`get`, `post`, `put`, `del`)
- `lib/darts.ts` — `parseDartScore`, `formatDart`
- `lib/socket.ts` — singleton socket.io-client
- `lib/suggestions.ts` — skill-tier suggestion engine + checkout hints + bogey + presets
- `lib/animations.ts` — GSAP overlays (180 / ton / game-shot / bust), Web Audio tones, Web Speech voice caller

### Components
- `AppHeader.tsx`
- `Scoreboard.tsx` — X01 + cricket scoreboard, sets/legs badges
- `ThrowHistory.tsx` — last 3 throws per player
- `SuggestionStrip.tsx`
- `X01Input.tsx` — quick numpad + presets with bogey warning
- `DartByDartPad.tsx` — multiplier + 1-20/Bull/Miss grid with mid-turn checkout
- `CricketInput.tsx`
- `CricketGrid.tsx` — `/` `X` `O` marks grid + points row
- `PostMatchReview.tsx` — Summary / Legs / Momentum tabs (Chart.js momentum graph)

---

## Build & Run

| Command | Effect |
|---------|--------|
| `npm install` | Install all workspace deps (first run compiles `better-sqlite3`) |
| `npm run dev` | Fastify (`tsx watch`) on `:3000` + Vite on `:5173` (`/api` & `/socket.io` proxied) |
| `npm run build` | Builds both workspaces — `apps/server/dist` + `apps/web/dist` |
| `npm start` | Runs compiled server; serves built web at the same port |
| `npm run typecheck` | Type-checks all workspaces |
| `docker compose up -d --build` | Build image and run on `:8080` |

---

## CI

`.forgejo/workflows/build-push.yml` runs on every push to `main` (or `workflow_dispatch`) and on changes to `Dockerfile`, `apps/**`, `package.json`, or `tsconfig.base.json`. Builds and pushes `forgejo.csodakucko.net/lendev/darts-game:<short-sha>` + `:latest` via the `homelab` runner.

---

## Completed Features

- [x] 501 / 301 / Cricket game modes
- [x] 10-level AI opponents with dart-physics simulation
- [x] Sets & Legs match formats (single / best-of-legs / sets)
- [x] Real-time Socket.IO with reconnection recovery
- [x] Dynamic throw suggestions (skill-tier personalized)
- [x] Complete checkout table (169 scores)
- [x] Bogey-number warnings in both input modes
- [x] Mid-turn checkout recalculation (dart-by-dart)
- [x] Dynamic preset buttons (context + skill aware)
- [x] True 3-dart average (actual darts thrown, not assumed 3)
- [x] Player stats: first-9 avg, best leg, 180s, bust rate, checkout %
- [x] GSAP overlay animations + Web Audio sound effects + Web Speech voice
- [x] Active player color theming (entire UI shifts via `--player-color`)
- [x] Screen wake lock
- [x] Responsive mobile-first design (Pixel 9 viewport)
- [x] PDC broadcast dark theme
- [x] Undo functionality
- [x] Post-match review with momentum graph
- [x] Admin reset endpoint
- [x] Multi-stage Docker build
- [x] Forgejo Actions CI/CD

---

## Future Enhancements

### High Impact
- [ ] **Google OAuth** — sign-in, profile pictures, account-tied stats (`GOOGLE-AUTH-SETUP.md`)
- [ ] **Remote Play** — WebRTC video feed + synced scoreboard over the internet (`REMOTE-PLAY.md`)
- [ ] **PWA support** — service worker caching, "Add to Home Screen"

### Medium Impact
- [ ] Bull-throw starting order
- [ ] Dartboard SVG tap input
- [ ] Head-to-head records
- [ ] Game history CSV export
- [ ] Practice mode (`PRACTICE_MODE.md`)

### Nice to Have
- [ ] Haptic feedback (mobile vibration on big scores)
- [ ] Custom game modes (701, 1001, etc.)
- [ ] Tournament brackets
- [ ] Theme customization (light, custom accents)
- [ ] Spectator mode (read-only live view)
