# Tournament Mode

**Status: T0 + T1 SHIPPED (2026-06-12) — knockout is live end-to-end.** League (T2),
groups→knockout (T3), AI-sim (T4), and online (T5) are still planned (see "Phased rollout").
A tournament meta-layer that orchestrates many ordinary `games` into a single competition —
single-elimination **knockout**, round-robin **league**, or **groups → knockout**. The user
picks one format per tournament. Humans and AI players can both enter. Single-device
pass-and-play works today; the schema and turn flow are shaped so online multi-device
tournaments drop in once the rest of Phase 8 lands.

**Shipped in T0 + T1:** all three tables + row types; `lib/tournaments.ts` contract;
`tournament-engine.ts` knockout generator (power-of-two padding, byes to top seeds, winner-path
wiring) with 21 unit tests; `tournament-store.ts` (create/get/list/launch/settle/delete);
the single `onGameCompleted` seam in `socket-handler.ts` + `tournament:<id>` room;
`routes/tournaments.ts`; Home tournament picker + active strip; Setup knockout branch;
`TournamentPage` (Bracket + Fixtures + champion screen, live via sockets); GamePage
"Back to Tournament". 33 new server tests (engine + routes incl. a full play-through).
**Only `format: 'knockout'` is accepted by the API right now** — league/groups 400 until T2/T3.

This doc is the contract for the build, modeled on how Practice Mode was added (`PRACTICE_MODE.md`):
standalone tables, a pre-written shared TS contract, parallel agents on disjoint files, an
integration gate at the end.

---

## Core architecture decision — tournaments orchestrate `games`, they don't replace them

A tournament match **is a normal `games` row** (`501` | `301` | `cricket`) played through the
existing, security-audited socket engine (`socket-handler.ts`, `game-state.ts`). The tournament
layer never re-implements scoring, busts, legs/sets, or win detection. It only:

1. holds the **format**, **roster**, and **match settings**;
2. **generates fixtures** (which players meet, in what round/group);
3. on each match's completion, **records the result and advances** the bracket / updates the
   standings, then marks the next match(es) playable;
4. owns its **own pages and views** (bracket, standings, fixtures, champion screen).

Why this shape (same reasoning as Practice Mode, `PRACTICE_MODE.md §Architecture decisions`):

- **Zero regression surface on competitive play.** The audited X01/cricket engine is reused
  verbatim. A tournament match plays identically to a one-off game.
- **`games.mode` CHECK stays intact.** No table rebuild (CLAUDE.md §4 forbids destructive
  migrations). Tournament data lives in its own additive tables.
- **Stats already work.** Each match is a real `games` row, so lifetime averages, 180s, checkout
  %, etc. accrue automatically — a tournament is "just" a labeled batch of games.

The **one surgical seam** into the audited code: when the server finishes a game (flips
`games.status = 'completed'`, sets `winner_id`, emits `game-over`), it calls
`onGameCompleted(gameId)` in the new `tournament-engine.ts`. That function checks whether the
game backs a `tournament_matches` row and, if so, settles the match and advances the tournament
**server-side**. This keeps result reporting server-authoritative — the client never tells the
server who won a tournament match (see `[[feedback_socket-guard-pattern]]`: never trust
client-supplied score/winner state).

---

## Data model (new tables — all additive, `CREATE TABLE IF NOT EXISTS` / `ALTER … ADD COLUMN`)

```sql
CREATE TABLE IF NOT EXISTS tournaments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  name           TEXT NOT NULL,
  format         TEXT NOT NULL CHECK (format IN ('knockout','league','groups_knockout')),
  mode           TEXT NOT NULL CHECK (mode IN ('501','301','cricket')),
  match_settings TEXT NOT NULL DEFAULT '{}',   -- JSON: { format:'legs'|'sets', bestOfLegs, bestOfSets, … } (same shape games.settings uses)
  options        TEXT NOT NULL DEFAULT '{}',    -- JSON: format-specific knobs (below)
  status         TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','in_progress','completed','abandoned')),
  is_online      INTEGER NOT NULL DEFAULT 0,    -- 0 = single-device pass-and-play; 1 = online (Phase 8 gate)
  winner_id      INTEGER REFERENCES players(id),
  created_by     INTEGER REFERENCES players(id),
  created_at     TEXT DEFAULT (datetime('now')),
  finished_at    TEXT
);

CREATE TABLE IF NOT EXISTS tournament_players (
  tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_id      INTEGER NOT NULL REFERENCES players(id),
  seed           INTEGER NOT NULL,              -- 1-based; drives bracket placement + group draw
  group_label    TEXT,                          -- 'A'|'B'… for groups_knockout, else NULL
  eliminated     INTEGER NOT NULL DEFAULT 0,    -- knockout convenience flag
  PRIMARY KEY (tournament_id, player_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  game_id         INTEGER REFERENCES games(id) ON DELETE SET NULL,  -- NULL until launched
  stage           TEXT NOT NULL,                 -- 'group' | 'ko' (knockout/league rounds both use 'ko'/'league')
  group_label     TEXT,                          -- group matches only
  round_num       INTEGER NOT NULL,              -- KO: 1=first round … final=max; League: matchday
  match_index     INTEGER NOT NULL,              -- position within the round (bracket slot order)
  home_player_id  INTEGER REFERENCES players(id),-- NULL = TBD (winner of a feeder match)
  away_player_id  INTEGER REFERENCES players(id),
  home_legs       INTEGER NOT NULL DEFAULT 0,    -- settled result (legs or sets won), for standings/leg-diff
  away_legs       INTEGER NOT NULL DEFAULT 0,
  winner_id       INTEGER REFERENCES players(id),
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','ready','in_progress','completed','bye')),
  next_match_id   INTEGER REFERENCES tournament_matches(id),  -- KO: where the winner goes
  next_slot       TEXT CHECK (next_slot IN ('home','away')),   -- which side of next_match
  created_at      TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tmatch_tournament ON tournament_matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_tmatch_game ON tournament_matches(game_id);
```

`status` lifecycle of a match: `pending` (one or both players TBD) → `ready` (both known, not
started) → `in_progress` (underlying game launched) → `completed` (game finished, result settled).
`bye` is a settled walkover that auto-advances its player. Bumped behind one
`PRAGMA user_version` step, per the `db.ts` pattern.

### `options` JSON by format

| format | options keys |
|--------|--------------|
| `knockout` | `{ thirdPlace: boolean }` — optional 3rd-place playoff. Bracket padded to next power of two with byes for the top seeds. |
| `league` | `{ doubleRoundRobin: boolean, pointsWin: number, pointsDraw: number }` — draws only possible in cricket; X01 always has a winner. Default `pointsWin: 2`. |
| `groups_knockout` | `{ groupCount: number, advancePerGroup: number, thirdPlace: boolean, doubleRoundRobin: boolean }` — round-robin within each group, top *N* advance into a seeded knockout. |

---

## Format engines (`tournament-engine.ts` — pure logic, no DB, like `practice-engine.ts`)

All three are deterministic given (sorted seeds, options). Unit-tested in isolation.

### Knockout (single elimination)
- `generateBracket(seeds)` pads the field to the next power of two (`2,4,8,16,32`); byes go to the
  **top seeds** (standard 1-v-bye placement). Produces all `tournament_matches` up front with
  `next_match_id` / `next_slot` wired so a winner propagates with no recompute.
- Round-1 matches with two real players are `ready`; bye matches are `bye` and immediately
  advance their player to the linked slot. Later rounds are `pending` until both feeders settle.
- Settling a match writes `winner_id`, sets the loser `eliminated`, copies the winner into
  `next_match.{home|away}_player_id`, and flips that match to `ready` once both slots are filled.
- Final's winner ⇒ `tournaments.winner_id`, status `completed`. Optional 3rd-place match seeded
  from the two semi-final losers.

### League (round-robin)
- `generateRoundRobin(players, double)` uses the **circle method** to produce balanced matchdays
  (each player one match per matchday, one sits out if odd). Single or double round-robin.
- Standings are **derived**, not stored: `computeStandings(matches, options)` →
  `{ playerId, played, won, lost, drawn, legsFor, legsAgainst, legDiff, points }[]`, sorted by
  `points → legDiff → legsFor → head-to-head → seed`. (Tiebreak order is fixed in v1; surfaced in
  the table footer so it's legible.)
- Tournament completes when every match is `completed`; `winner_id` = standings row 0.

### Groups → knockout
- Snake-draft seeds into `groupCount` groups, round-robin each group (reuses the league engine),
  then once **all** group matches are `completed`, `seedKnockoutFromGroups(standings, advancePerGroup)`
  builds the knockout bracket (reuses the knockout engine) with cross-group seeding (A1 vs B2, …).
- Two stages tracked by `tournament_matches.stage` (`'group'` then `'ko'`).

---

## Match lifecycle — how a fixture becomes a played game

1. **Launch.** User taps **Play** on a `ready` match → `POST /api/tournaments/:id/matches/:mid/launch`.
   The route creates a normal game (same insert path as `POST /api/games`: `games` row + two
   `game_players` + `cricket_state` if cricket), copies `tournament.match_settings` into
   `games.settings`, sets `tournament_matches.game_id` + status `in_progress`, returns `{ gameId }`.
   Client navigates to `/game?id=<gameId>`.
2. **Play.** Entirely the existing socket flow — untouched. For **AI** entrants the existing
   `checkAndTriggerAiTurn` drives their throws automatically; an all-AI match still completes
   on its own (a "Sim" affordance can launch it headless — see Phase T4).
3. **Settle (server-authoritative).** On win, the existing handler sets `winner_id` and emits
   `game-over`, **then calls `onGameCompleted(gameId)`**. That looks up the backing match, reads
   final legs/sets from `game_players`, writes `home_legs`/`away_legs`/`winner_id`, advances the
   format engine, and emits `tournament-updated { tournamentId }` to the tournament room.
4. **Return.** `GamePage` detects the game belongs to a tournament (full state carries
   `tournamentId` + `tournamentMatchId`) and shows **"Back to tournament"** alongside the normal
   review — replacing the "Rematch" CTA, which doesn't make sense inside a bracket.

> The only edit to `socket-handler.ts` is the single `onGameCompleted(gameId)` call after
> `winner_id` is set. Everything else is new files. (Alternative considered: an EventEmitter the
> tournament module subscribes to — same effect, marginally looser coupling; a direct call is
> chosen for legibility and because it's still fully server-side.)

---

## REST + socket contract

**Shared contract file (written first):** `apps/web/src/lib/tournaments.ts` — all camelCase client
types (`TournamentState`, `TournamentMatch`, `StandingsRow`, `BracketRound`, `TournamentSummary`),
the `FORMATS` metadata (icon/name/description/min-max players per format, mirrors `lib/modes.ts` +
`DRILLS`), and the `api`-wrapped functions. Server returns these exact shapes. This is the seam
both sides code against in parallel.

### REST (`/api`, auth mirrors `games.ts`: `req.player` + `isAdmin`; non-admins scoped to
tournaments they created or play in)

- `POST /api/tournaments` — `{ name, format, mode, matchSettings, options, playerIds, isOnline? }`
  → validates roster size for the format, generates fixtures, `201 TournamentState`.
- `GET /api/tournaments?status=` — list (scoped).
- `GET /api/tournaments/:id` — full `TournamentState` (players, derived standings, matches as
  bracket rounds or matchdays).
- `POST /api/tournaments/:id/matches/:mid/launch` — create the backing game; `{ gameId }`. Guards:
  match must be `ready`, caller must be admin/creator (single-device) or a participant in that
  match (online).
- `DELETE /api/tournaments/:id` — abandon (cascade; deletes scheduled-but-unplayed games too).
- *(Phase T5, online only)* `POST /api/tournaments/:id/join { code }` — reuse the Phase 8 invite
  pattern to add a player to a `setup` tournament.

### Socket events (server-authoritative; new room `tournament:<id>`)
- **Client → Server:** `join-tournament { tournamentId }` / `leave-tournament` — read-only room
  subscription so bracket/table views live-update. **Must carry the same auth/participation guard
  as `submit-turn`** (`[[feedback_socket-guard-pattern]]`): only signed-in viewers, and for
  private/online tournaments only participants + admin.
- **Server → Client:** `tournament-updated { tournamentId }` — emitted from `onGameCompleted` and
  on launch; clients refetch `GET /api/tournaments/:id`.

No tournament *scoring* travels over sockets — the room is a notification channel only.

---

## Pages & views (apply the Frontend Design Skill — `FRONTEND-DESIGN-SKILL.md`)

The app's house style is a **PDC-broadcast dark theme** (Oswald display, Barlow/Barlow Condensed
body; navy `#0b0f19`/`#121828`, red `#e53935`, gold `#fbbf24`, green `#22c55e`). The tournament UI
leans into that with a **"championship broadcast"** direction: TV-bracket geometry, gold winner-path
highlighting, GSAP reveal-on-load, and a celebratory podium. Before coding the views, the design
agent should commit to one bold direction and present **2 quick visual options** for the signature
screen (the bracket) per the skill's "pick a bold aesthetic" step.

1. **Home (`pages/Home.tsx`)** — add a third picker group **"Tournament"** under Play/Practice,
   with three `ModeTile`s (Knockout / League / Groups) → `/setup?tournament=<format>`. An
   **active-tournaments strip** (like the Resume strip) links into running tournaments.

2. **Setup (`pages/Setup.tsx`)** — extend the existing per-mode setup flow with a tournament
   branch: name, game mode (501/301/cricket), match settings (Bo-legs/sets reusing the existing
   format picker), **multi-select roster** (humans + AI, 4–32 players), seeding (drag-to-reorder or
   auto by lifetime average), and format-specific options (RR single/double + points; group count +
   advance count; 3rd-place toggle). **Create** → `/tournament?id=N`.

3. **Tournament detail (`pages/TournamentPage.tsx`, route `/tournament?id=N`)** — the centerpiece,
   with view tabs (which tabs show depends on `format`):
   - **Bracket** (knockout, + the KO stage of groups) — horizontally scrollable rounds of match
     cards with connective lines, seed numbers, live scores, a **gold champion path**, and the
     final/champion slot. GSAP cascades the rounds in on load and animates a winner advancing when
     a result lands.
   - **Table** (league) — standings leaderboard: pos, player (avatar via `<PlayerAvatar>`),
     P/W/L(/D), legs for-against, leg diff, points; podium-gold top rows; animated rank changes;
     tiebreak rule shown in the footer.
   - **Groups** (groups_knockout) — a grid of mini-tables (one per group) feeding the bracket tab.
   - **Fixtures** — matches grouped by round/matchday; each `ready` match has a **Play** button
     (admin/creator or the match's participants), `in_progress` shows "Resume", `completed` shows
     the score. Byes rendered as walkovers.
   - **Champion screen** — on `completed`, a **podium** (1st/2nd/3rd) with `canvas-confetti` +
     trophy + GSAP, reusing the existing animation layer. "New tournament" / "Home" CTAs.

4. **GamePage (`pages/GamePage.tsx`)** — when the loaded game is a tournament match, swap the
   post-match "Rematch" CTA for **"Back to tournament"** (`/tournament?id=…`), and add a slim
   tournament-context banner (e.g. "Quarter-Final · Knockout Cup").

5. **Stats (`pages/Stats.tsx`)** — a **Tournament** section per player: titles won, finals reached,
   tournaments entered. (Per-match stats already flow through the normal `games`-based stats.)

6. **CSS** — one appended `/* Tournament Mode */` block in `styles/app.css`, single-owner (the
   web-play agent), matching the Practice-Mode CSS discipline. Bracket lines via CSS/SVG; respect
   the `body.*-page` viewport-lock convention if the bracket needs a dedicated scroll container.

---

## Phased rollout

Each phase is shippable and builds on the last. Formats are independently selectable, so the
engines can land one at a time behind the same shell.

- **T0 — Foundation & contract.** Tables in `db.ts` (+ `user_version` bump), `types.ts` rows,
  `lib/tournaments.ts` contract committed first. `tournament-engine.ts` with the **knockout** engine
  + unit tests. `onGameCompleted` seam wired into `socket-handler.ts`.
- **T1 — Knockout end-to-end.** Routes (`create`/`get`/`list`/`launch`/`delete`), Home tile,
  Setup branch, `TournamentPage` Bracket + Fixtures tabs, champion screen, GamePage "Back to
  tournament". Single-device pass-and-play. **First playable tournament.**
- **T2 — League.** `generateRoundRobin` + `computeStandings` engine + tests; Table view; matchday
  fixtures. Reuses all of T1's shell.
- **T3 — Groups → Knockout.** Group draw + `seedKnockoutFromGroups`; Groups view; two-stage
  progression. Reuses T1 bracket + T2 tables.
- **T4 — AI polish.** "Simulate match" for all-AI fixtures (run the AI loop to completion without
  opening the board), and a "Sim to next human match" convenience for solo bracket-running.
- **T5 — Online (depends on Phase 8).** Flip `is_online`, gate `launch` to the match's
  participants, reuse Phase 8 invite codes for joining a `setup` tournament, push "your match is
  ready" via the Phase 8 notification path. **Blocked until Phase 8's turn-gate ships.**

---

## Build strategy — parallel agents on a shared contract (per `PRACTICE_MODE.md §How this was built`)

1. **Contract first:** commit `lib/tournaments.ts` (+ server `types.ts` rows) before fan-out.
2. **Disjoint file owners, concurrent:**
   - **Server** — `db.ts`, `types.ts`, `tournament-engine.ts`, `routes/tournaments.ts`,
     `app.ts` (register), the `onGameCompleted` call in `socket-handler.ts`, and
     `test/tournament-engine.test.ts`. Owns its own typecheck + vitest.
   - **Web-Play** — `TournamentPage.tsx`, bracket/table/groups/champion components, `App.tsx`
     route, and **all** tournament CSS in `app.css` (single owner of the file).
   - **Web-UI** — `Home.tsx` + `Setup.tsx` + `Stats.tsx` only; consumes the contract + the CSS
     classes Web-Play defines; touches neither `app.css` nor `App.tsx`.
3. **Integration gate (parent):** `npm run typecheck` (both workspaces) → `npm run build` (runs the
   vitest gate — see `[[reference_darts-test-gate]]`) → runtime smoke (routes 401 not 404).

---

## Risks / non-obvious gotchas

- **The `onGameCompleted` seam touches the audited handler.** Keep it to one call after
  `winner_id` is set; the function itself lives in the new module and must no-op cleanly for
  non-tournament games (the overwhelming common case).
- **Result must be read server-side from `game_players`,** never from a client message
  (`[[feedback_socket-guard-pattern]]`). Legs/sets won are already persisted there.
- **AI auto-turn across scheduled matches.** AI only throws in the *currently open* game. A bracket
  of AI-vs-AI matches won't self-run until each is launched — hence the T4 "simulate" affordance.
  Don't assume launching a tournament plays it out.
- **`better-sqlite3` is single-process** — standings are derived on read inside one process; fine
  at this scale. Stay single-instance (same note as Phase 8).
- **Odd rosters / non-power-of-two knockouts** need byes; the engine must place them at the top
  seeds and auto-advance, or round 1 will have dangling slots.
- **Abandoning a tournament** should cascade-delete scheduled-but-unplayed games (and orphaned
  `game_players`/`cricket_state`) so the lobby's Resume strip doesn't fill with phantom fixtures.
- **Online (T5) is genuinely blocked on Phase 8** — the per-participant turn-gate doesn't exist
  yet, so don't gate `launch` per-participant until that lands; single-device treats any
  admin/creator as able to launch.

---

## Verification checklist (per phase)

- [ ] `npm run typecheck` clean (server + web)
- [ ] `npm run build` green (vitest gate passes — `[[reference_darts-test-gate]]`)
- [ ] Engine unit tests: bracket padding/byes, winner propagation, RR matchday balance, standings
      sort + tiebreaks, group → KO seeding
- [ ] Routes registered + auth-gated (401 not 404)
- [ ] Manual click-through on a real device: create → launch a match → finish → result settles →
      bracket/table advances → champion screen
- [ ] Tournament matches still accrue normal lifetime stats (they're real `games` rows)
- [ ] Non-tournament games unaffected (`onGameCompleted` no-ops)
</content>
</invoke>
