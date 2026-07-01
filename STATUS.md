# Darts Counter — Project Status

Last updated: 2026-07-01

---

## Codebase Overview

| Category | Files | Notes |
|----------|-------|-------|
| Server TypeScript | 24 | `apps/server/src/**.ts` — Fastify app + entry, auth, sockets, AI, DB, sanitize, practice, tournament engine/store, friends, push, routes |
| Frontend TypeScript / TSX | 47 | `apps/web/src/**.{ts,tsx}` — React app, pages, components, contexts, hooks, libs |
| CSS | 1 | `apps/web/src/styles/app.css` (PDC dark theme) |
| Server tests | 25 | `apps/server/test/*.test.ts` (vitest + `Fastify.inject()`) — 288 tests (incl. `atc.test.ts`) |
| Web tests | 2 | `apps/web/test/*.test.ts` |
| E2E tests | 2 | `e2e/*.spec.ts` (Playwright — 501 + cricket) |
| Docker | 2 | `Dockerfile` (multi-stage), `docker-compose.yml` |
| CI | 1 | `.forgejo/workflows/build-push.yml` |

**Stack:** Node.js 20 + Fastify 5 + Socket.IO 4 + better-sqlite3 (server) — React 18 + Vite 5 + react-router-dom + socket.io-client (web) — all TypeScript, ESM, npm workspaces monorepo. Auth via `google-auth-library` (Google Sign-In) with a passwordless local-sign-in fallback when Google isn't configured.

**External libs at runtime:** GSAP (animations), canvas-confetti (180s/checkouts), Chart.js + chartjs-plugin-annotation + react-chartjs-2 (momentum graph), Google Fonts (Oswald, Barlow, Barlow Condensed), Google Identity Services (sign-in).

---

## Server (apps/server/src/)

| File | Purpose |
|------|---------|
| `index.ts` | Process entry — builds the app via `buildApp`, prunes expired sessions, serves the built SPA in prod (`@fastify/static` + SPA fallback), attaches Socket.IO, listens |
| `app.ts` | `buildApp()` — Fastify factory: helmet (CSP for GSI), CORS allowlist, rate-limit (keyed by session player, falls back to IP), global `/api/*` auth preHandler (except `/api/auth/*`), registers all route plugins. Test-friendly options (`helmet`/`rateLimit` toggles) |
| `auth.ts` | Google credential verify + player upsert, local-player upsert, session create/lookup/prune, `isAdmin` (ADMIN_EMAILS + local-admin sentinel), `requireSession`/`requireAdmin` guards, `playerFromRequest` |
| `sanitize.ts` | Strips `email`/`google_id` PII from player rows for non-self/non-admin viewers; `stripPiiFromGameState` for socket broadcasts |
| `db.ts` | better-sqlite3 connection, WAL mode, FK on, idempotent schema + additive `ALTER`s, `PRAGMA user_version` migration (one-shot pre-Google local wipe), AI player seeding |
| `types.ts` | Shared TS types: `Player`, `Session`, `Game`, `Turn`, `CricketState`, `MatchSettings`, `FullGameState`, practice rows, drill/difficulty enums |
| `darts.ts` | `parseDartScore`, `parseCricketDart`, `isValidDart`, `applyAtcDart` (around-the-clock advance rule) |
| `checkout-table.ts` | 169-entry double-out lookup (2 → 170) |
| `game-state.ts` | `getFullGameState(gameId)` — single aggregator: players, turns, scores, set/leg tracking, current player index (replays turns so uneven sets keep the right thrower) |
| `ai-engine.ts` | 10-level dart-physics simulator + X01 (double/single-out) / cricket / around-the-clock strategy |
| `practice-engine.ts` | Pure drill logic for the 4 practice modes (checkout / scoring / around-the-clock / doubles) |
| `tournament-engine.ts` | Pure knockout bracket generation (power-of-two padding, byes to top seeds, winner-path wiring); no DB |
| `tournament-store.ts` | Tournament DB layer: create/get/list/launch/settle/delete; `settleCompletedGame` is the seam target |
| `socket-handler.ts` | `join-game`, `submit-turn`, `undo-turn`, `join/leave-tournament` handlers; session auth middleware; turn validation; bust + leg/set transitions; cricket scoring + undo revert; AI triggering; the `onGameCompleted` tournament seam |
| `routes/tournaments.ts` | Tournament CRUD + match launch/simulate + join/start (`/api/tournaments…`), auth-scoped |
| `routes/friends.ts` | Friends graph: list (with presence) / invite / accept / remove |
| `push.ts` + `routes/push.ts` | Web-push (VAPID) subscriptions + `sendPushToPlayer`; vapid/subscribe/unsubscribe |
| `routes/auth.ts` | `/api/auth/{config,google,local,me,logout}` |
| `routes/players.ts` | CRUD `/api/players` (self-service rename + admin management) |
| `routes/games.ts` | CRUD `/api/games`; participant/admin scoping; PII scrub on responses |
| `routes/stats.ts` | `/api/stats/players/:id`, `/api/stats/games/:id` (with leg-by-leg breakdown) |
| `routes/practice.ts` | Practice session lifecycle endpoints |
| `routes/admin.ts` | `DELETE /api/admin/reset` (admin-only) |

---

## Frontend (apps/web/src/)

### Entry & shell
- `main.tsx` — ReactDOM root, `BrowserRouter`, wraps `<App>` in `<AuthProvider>`
- `App.tsx` — gates on `useAuth()`: loading splash → `<SignIn>` when signed out → routed app. Routes: `/`, `/setup`, `/game`, `/practice`, `/profile`, `/stats`, `/admin` (admin-gated)
- `contexts/AuthContext.tsx` — `AuthProvider` + `useAuth`: Google + local sign-in, `/api/auth/me` rehydrate, sign-out, `auth:expired` handling, socket disconnect on auth change

### Pages
- `pages/SignIn.tsx` — Google Identity Services button + local sign-in (when enabled)
- `pages/Home.tsx` — mode-picker landing (match modes + practice drills) + Resume strip for in-progress games
- `pages/Setup.tsx` — per-mode setup: format pickers, player select grid, inline add-player, AI opponent, bull-throw start; practice setup branch
- `pages/GamePage.tsx` — owns the live game; wires `useGame`, suggestion, animations, voice, wake-lock, post-match overlay
- `pages/PracticePage.tsx` — live practice drill UI
- `pages/TournamentPage.tsx` — bracket / table / groups / fixtures / champion + setup lobby (live via the `tournament:<id>` socket room)
- `pages/Friends.tsx` — friends list with presence, invites, add by name/email
- `pages/Profile.tsx` — self-service profile (rename / nickname)
- `pages/Admin.tsx` — admin player management
- `pages/Stats.tsx` — per-human-player lifetime stats

### Hooks
- `hooks/useGame.ts` — subscribes to `game-state`, `game-over`, `ai-thinking`; exposes `submitTurn`, `undoTurn`; double-submit lock; triggers throw animations on new turns

### Libraries
- `lib/api.ts` — typed `fetch` wrapper (`get`/`post`/`put`/`del`); 401 → clear token + `auth:expired`
- `lib/auth.ts` — token storage + `authHeaders`
- `lib/darts.ts` — `parseDartScore`, `formatDart`
- `lib/socket.ts` — singleton socket.io-client (auth token in handshake)
- `lib/suggestions.ts` — skill-tier suggestion engine + checkout hints + bogey + presets
- `lib/modes.ts` — match-mode metadata
- `lib/practice.ts` — drill metadata + practice API helpers
- `lib/bull-throw.ts` — bull-throw ordering logic
- `lib/animations.ts` — GSAP overlays (180 / ton / game-shot / bust), Web Audio tones, Web Speech voice caller

### Components
`AppHeader`, `Scoreboard`, `ThrowHistory`, `SuggestionStrip`, `X01Input`, `DartByDartPad`, `CricketInput`, `CricketGrid`, `PracticeDartPad`, `PostMatchReview`, `ModeTile`, `PlayerSelectGrid`, `AddPlayerInline`, `PlayerAvatar`, `BullThrow`, `UpdatePrompt` (PWA), `TestModeBadge`

---

## Build & Run

| Command | Effect |
|---------|--------|
| `npm install` | Install all workspace deps (first run compiles `better-sqlite3`) |
| `npm run dev` | Fastify (`tsx watch`) on `:3000` + Vite on `:5173` (`/api` & `/socket.io` proxied) |
| `npm run build` | Builds both workspaces — `apps/server/dist` + `apps/web/dist` |
| `npm start` | Runs compiled server; serves the built web at the same port |
| `npm run typecheck` | Type-checks all workspaces |
| `npm test` | Runs server + web unit/integration tests (vitest) |
| `npm run test:e2e` | Playwright UI tests (501 + cricket) |
| `docker compose up -d --build` | Build image and run on `:8080` |

---

## Auth

- **Google Sign-In** gates the whole app. `/api/auth/config` drives the client at runtime; the global `/api/*` preHandler (except `/api/auth/*`) requires a session; Socket.IO validates the session in handshake middleware.
- **Local sign-in** is a passwordless fallback enabled only when no Google client id is set (self-hosted convenience). Local accounts carry the `admin@local` sentinel and get admin in that mode.
- **Admins** = emails in `ADMIN_EMAILS` (plus the local-admin sentinel in local mode). Admin-only: `DELETE /api/admin/reset`, cross-player management, viewing any game.
- **PII scrubbing** — `email`/`google_id` are stripped from player rows sent to anyone who isn't that player or an admin (REST responses + socket broadcasts).
- **Test/dev config** — `TEST_GOOGLE_CLIENT_ID` takes precedence over `GOOGLE_CLIENT_ID`; when used, a "Test config" badge shows in the UI.

---

## CI

`.forgejo/workflows/build-push.yml` runs on every push to `main` (or `workflow_dispatch`) and on changes to `Dockerfile`, `apps/**`, `package.json`, or `tsconfig.base.json`. Builds and pushes `forgejo.csodakucko.net/lendev/darts-game:<short-sha>` + `:latest` via the `homelab` runner.

---

## Completed Features

- [x] 501 / 301 / Cricket / Around-the-Clock game modes
- [x] X01 checkout rule selectable: double-out (default) or single-out
- [x] Around-the-Clock: race 1→20 then bull; advance rule = exact-single (default) or doubles/trebles skip (+2/+3)
- [x] 10-level AI opponents with dart-physics simulation
- [x] Sets & Legs match formats (single / best-of-legs / sets), uneven-set leg rotation fixed
- [x] Real-time Socket.IO with reconnection recovery
- [x] Dynamic throw suggestions (skill-tier personalized)
- [x] Complete checkout table (169 scores)
- [x] Bogey-number warnings in both input modes
- [x] Mid-turn checkout recalculation (dart-by-dart)
- [x] Dynamic preset buttons (context + skill aware)
- [x] True 3-dart average (actual darts thrown)
- [x] Player stats: first-9 avg, best leg, 180s, bust rate, checkout %
- [x] GSAP overlay animations + Web Audio sound effects + Web Speech voice
- [x] Active player color theming (entire UI shifts via `--player-color`)
- [x] Screen wake lock
- [x] Responsive mobile-first design (Pixel 9 viewport)
- [x] PDC broadcast dark theme
- [x] Undo functionality (X01 leg/set rebuild + cricket revert)
- [x] Post-match review with momentum graph
- [x] Admin reset endpoint (admin-only)
- [x] Multi-stage Docker build
- [x] Forgejo Actions CI/CD
- [x] **Google Sign-In** (Phase 7) — sign-in gate, sessions, socket handshake, `ADMIN_EMAILS`, native auth (no Authentik gate). Profile pictures via `<PlayerAvatar>`
- [x] **Local passwordless sign-in** — self-hosted fallback when Google isn't configured; `TEST_GOOGLE_CLIENT_ID` precedence + "Test config" badge
- [x] **PWA** — webmanifest + maskable icons + service worker + offline app shell + `<UpdatePrompt>`
- [x] **Bull throw for starting order** — pre-game ordering UI
- [x] **Mode-picker home + per-mode setup flow** — replaced the single-page lobby
- [x] **Practice Mode** — 4 solo drills (checkout / scoring / around-the-clock / doubles), server-persisted sessions + history
- [x] **Self-service Profile page + admin player management**
- [x] **Uploaded profile pictures** — POST `/api/players/:id/avatar` (self or admin; JPEG/PNG/WebP ≤5 MB, stored on the data volume, served auth-exempt for `<img>`); upload UI on Profile + Admin
- [x] **DB-backed admin assignment** — `players.is_admin` flag; `isAdmin()` honors it (in addition to `ADMIN_EMAILS`/local-admin); `POST /api/players/:id/admin` toggle + ★ control on the Admin page
- [x] **Health/version endpoint** — `GET /api/health` (unauthenticated): backend status + git-SHA `version` + uptime + frontend-served flag; `GIT_SHA` baked into both the server env and the web bundle (Vite define) at image build; `/health` page cross-checks frontend vs backend version
- [x] **Auth/rate-limit hardening** — session-keyed rate limiting, turn-submission + stats scoping, helmet CSP, CORS allowlist
- [x] **PII scrubbing** — email/google_id stripped for non-self/non-admin viewers
- [x] **Two-round security audit closed** — see `SECURITY_FINDINGS.md`. Open: H4 (auth token → HttpOnly cookie + CSRF) deferred until an XSS sink lands
- [x] **Tournament Mode — Knockout (Phase 9, T0+T1)** — single-elimination brackets that orchestrate ordinary games: power-of-two padding with byes to top seeds, server-authoritative settle/advance via the single `onGameCompleted` seam, live bracket/fixtures via the `tournament:<id>` socket room, champion screen. League/groups designed but not yet wired (API 400s them)
- [x] **Test coverage** — 24 server suites / 273 tests (`Fastify.inject()` + pure-engine units: routes, auth, auth-local, security ×2, sets, cricket, x01, quick-entry, undo, ai-games, online, friends, push, health, players-admin-avatar, tournament-engine, tournaments ×4 (knockout/online/league/groups/simulate), practice ×2) + 2 web suites + 2 Playwright e2e specs (501, cricket)

---

## Future Enhancements

### High Impact
- [x] **Phase 8 — Online multiplayer** — invite codes, server-side turn gate, friends, web push, spectator mode (rollout 8a–8d, all shipped 2026-06-12).
  - [x] **8a — turn gate + invite codes**: `is_online` + `invite_code` games, capacity via `settings.maxPlayers`, `POST /api/games/join`, online-only turn ownership, Setup online toggle + Home join-by-code + GamePage waiting/your-turn states.
  - [x] **8b — friends graph + presence**: `friends` table, invite/accept/remove, `/friends` page, socket-connection presence dots.
  - [x] **8c — web push**: `push_subscriptions` + VAPID (`web-push`), `push-sw.js` in the Workbox SW, "your turn" push on online turn changes, Profile toggle. (Async-turn play not built; set `VAPID_*` env to enable.)
  - [x] **8d — spectator mode**: read-only `join-game` for any signed-in user, GamePage spectating state, "Watch" link on in-progress tournament ties.
- [ ] **Remote Play** — WebRTC video feed + synced scoreboard over the internet (`REMOTE-PLAY.md`)

### Medium Impact
- [x] **Phase 9 — Tournament Mode** — all formats shipped 2026-06-12 (`TOURNAMENT_MODE.md`).
  - [x] **T0/T1 — Knockout**: engine + store + routes + `TournamentPage` (bracket/fixtures/champion).
  - [x] **T2 — League**: round-robin (circle method) + standings table.
  - [x] **T3 — Groups → Knockout**: snake-draft groups → cross-seeded bracket, Groups view.
  - [x] **T4 — AI simulate**: headless all-AI match play-out (⚡ Sim).
  - [x] **T5 — Online tournaments**: code-join lobby → start; matches are online games (8a gate).
  - Deferred: 3rd-place playoff, auto-seed by average, head-to-head tiebreak.
- [ ] Dartboard SVG tap input
- [ ] Head-to-head records
- [ ] Game history CSV export
- [ ] **H4 — auth token → HttpOnly cookie + CSRF** (defense-in-depth; deferred until an XSS sink appears, see PLAN.md)

### Nice to Have
- [ ] Haptic feedback (mobile vibration on big scores)
- [ ] Custom game modes (701, 1001, etc.)
- [ ] Theme customization (light, custom accents)
- [ ] Spectator mode (read-only live view) — subsumed by Phase 8d
