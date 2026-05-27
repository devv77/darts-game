# Practice Mode

**Status: IMPLEMENTED for v2 (2026-05-27).** Solo training system with 4 drill types, progress tracking, and per-drill history. Built against the v2 TypeScript monorepo — this doc supersedes the original v1 plan (which referenced `server/db.js`, `public/js/*.js`, none of which exist anymore).

## Architecture decisions (and why they differ from the original v1 plan)

The original plan proposed reusing the `games` table with `practice_*` mode values and a Socket.IO turn flow. On the v2 stack that's the wrong shape, for two concrete reasons:

1. **Standalone tables, not `practice_*` game modes.** `games.mode` has a SQL `CHECK (mode IN ('501','301','cricket'))`. SQLite can't relax a CHECK constraint with `ALTER`; it requires a table rebuild, which violates this repo's "schema migrations are additive-only at boot" rule (CLAUDE.md §4). Practice instead lives in its own `practice_sessions` + `practice_history` tables. Bonus: the security-audited X01/cricket engine (`socket-handler.ts`, `game-state.ts`) is never touched, so there's zero regression surface on competitive play. Competitive stats already filter `mode IN ('501','301')`, so practice is excluded for free.

2. **REST, not Socket.IO, for turns.** Practice is single-player — there are no other clients in the room to broadcast to. Plain REST (`POST /api/practice/:id/turn` → returns new state) is simpler, and it keeps the audited socket handler untouched. Reconnect/refresh recovery is just `GET /api/practice/:id`. Animations/voice fire client-side off the REST response.

## 4 Drill Types

| Drill | Targets | Input | Rules |
|-------|---------|-------|-------|
| **Checkout** (`checkout`) | 10 random checkout scores from the difficulty range (easy 2–40, medium 41–100, hard 101–170) | dart-by-dart, 1 turn (≤3 darts)/target | success = reach 0 with the last dart a double; bust = <0, =1, or =0 not on a double. Hint = checkout path from `checkout-table.ts`. |
| **Scoring** (`scoring`) | 10 rounds | numpad (0–180) | pure scoring, no bust rules. Tracks running 3-dart average vs the player's lifetime 501/301 average. 180/ton animations fire. |
| **Around the Clock** (`around_the_clock`) | 1→20 then Bull (21 targets) | dart-by-dart | hit current target with any segment (S/D/T; SB/DB for Bull). Multiple targets can advance in one turn. Tracks total darts + elapsed time. |
| **Doubles** (`doubles`) | 10 random doubles (D1–D20 + DB) | dart-by-dart, up to 9 darts (3 turns)/target | success = hit the exact double. Tracks hit rate + a per-double weakness heatmap (`perDouble`). |

## File map (v2)

**Server (`apps/server/src/`)** — owned by one agent, disjoint from web:
- `db.ts` — added `practice_sessions` + `practice_history` (`CREATE TABLE IF NOT EXISTS`, additive). `games.mode` CHECK untouched.
- `types.ts` — `DrillType`, `Difficulty`, `PracticeSessionRow`, `PracticeHistoryRow`.
- `practice-engine.ts` *(new)* — pure logic, no DB: `generateTargets`, `applyTurn`, `computeMetrics`, `summaryMetricsForHistory`, local `dartSegment` helper. Reuses `parseDartScore`/`isValidDart` (`darts.ts`) and `checkouts` (`checkout-table.ts`).
- `routes/practice.ts` *(new)* — `POST /api/practice`, `GET /api/practice/:id`, `POST /api/practice/:id/turn`, `GET /api/practice/history/:playerId`. Auth mirrors `games.ts` (`req.player` + `isAdmin`; a player may only practice as themselves unless admin). `lifetimeAvg` computed here (route owns DB) and injected into scoring metrics.
- `app.ts` — registers `practiceRoutes`.
- `test/practice-engine.test.ts` *(new)* — 15 vitest cases (generation ranges/counts, checkout success+bust, scoring avg, ATB multi-advance, doubles hit + 9-dart miss + heatmap).

**Web (`apps/web/src/`)**:
- `lib/practice.ts` *(new — the shared contract)* — client types (`PracticeState`, `PracticeTarget`, `PracticeResult`, `PracticeMetrics`, `PracticeHistoryEntry`), `DRILLS` metadata, and the `api`-wrapped fns (`createPractice`, `getPracticeState`, `submitPracticeTurn`, `getPracticeHistory`). The server returns these exact camelCase shapes.
- `pages/PracticePage.tsx` *(new)* — route `/practice?id=N`. Loads session, renders drill header/target/progress + live metrics + ATB track, routes input (numpad for scoring, dart pad otherwise), fires animations off each response, shows a completion summary.
- `components/PracticeDartPad.tsx` *(new)* — practice dart entry (mirrors `DartByDartPad`'s UI/classes, minus X01 checkout-hint/bogey logic). `DartByDartPad.tsx` itself is left untouched to avoid live-game regressions.
- `App.tsx` — `/practice` route.
- `pages/Lobby.tsx` — "Practice" card: 4 drill cards, difficulty picker (checkout), single-player select (defaults to signed-in user), Start → `createPractice` → navigate.
- `pages/Stats.tsx` — per-player "Practice" history section.
- `styles/app.css` — one appended `/* Practice Mode */` block (drill cards, target display, progress bar, ATB track, completion, stats rows).

## REST contract

All responses are the camelCase `PracticeState` (or `PracticeHistoryEntry[]`) defined in `apps/web/src/lib/practice.ts` — that file is the single source of truth.

- `POST /api/practice` — `{ playerId, drillType, difficulty? }` → `201 PracticeState`
- `GET /api/practice/:id` → `PracticeState` (owner/admin only)
- `POST /api/practice/:id/turn` — `{ darts?: string[] }` (checkout/atb/doubles) or `{ scoreTotal: number }` (scoring) → new `PracticeState`. On the final turn the route stamps `finished_at` and writes `practice_history` summary rows.
- `GET /api/practice/history/:playerId` → `PracticeHistoryEntry[]` (owner/admin only)

## How this was built — parallel agents against a shared contract

The feature cuts across server + web, but was parallelized cleanly:

1. **Contract first.** `lib/practice.ts` (types + `DRILLS` + API wrappers) was written and committed up front as the interface both sides code to.
2. **Three agents, disjoint file sets, run concurrently** in the same working tree (no worktrees needed because nothing overlaps):
   - **Server** — everything under `apps/server` (own directory; ran its own typecheck + vitest).
   - **Web-Play** — `PracticePage.tsx`, `PracticeDartPad.tsx`, `App.tsx`, and *all* practice CSS in `app.css` (single owner of `app.css`).
   - **Web-UI** — `Lobby.tsx` + `Stats.tsx` only; consumed the contract and the CSS class names Web-Play defined, but edited neither `app.css` nor `App.tsx`.
   The web agents deliberately did **not** run `tsc` (concurrent edits would make a full project typecheck see each other's in-progress files); the parent typechecked centrally after all three finished.
3. **Integration gate (parent).** `npm run typecheck` (both workspaces) → clean; `npm run build` → green; server `vitest` → 134 passing; runtime smoke (routes return 401 not 404 = registered + auth-gated).

The key enabler was making the three streams touch **non-overlapping files**, with one pre-written contract file as the seam. That turns a tightly-coupled full-stack feature into independent parallel work with a trivial (empty) merge.

## Verification checklist

- [x] `npm run typecheck` clean (server + web)
- [x] `npm run build` green
- [x] 15 engine unit tests + 119 existing tests pass
- [x] Practice routes registered + auth-gated (runtime smoke)
- [ ] Manual click-through of each drill on a real device (do after deploy to LXC 208)
- [x] Practice excluded from competitive stats (no rows in `games`; stats filter `mode IN ('501','301')`)
