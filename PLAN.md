# Darts Counter - Application Plan

A self-hosted web application for tracking darts games. Run it with `docker compose up` or `npm start` and open your browser.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Node.js + Express + Socket.IO | Simple, no build step, real-time updates via WebSocket |
| Frontend | Vanilla JS (no framework) | No framework overhead, mobile-friendly |
| CSS | Custom CSS + Google Fonts (Oswald, Barlow) | PDC broadcast-inspired dark theme, no CSS framework |
| Database | SQLite (better-sqlite3) | Zero config, single file, no external DB needed |
| Deployment | Docker (single container) | `docker compose up -d --build` and done |

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
- **Display**: Mark grid showing /, X, circled-X for 1, 2, 3 marks per player

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
├── Dockerfile
├── docker-compose.yml
├── package.json
├── .dockerignore
├── .gitignore
├── PLAN.md
├── CLAUDE.md
├── server/
│   ├── index.js              # Express + Socket.IO entry point
│   ├── db.js                 # SQLite connection + schema migrations
│   ├── routes/
│   │   ├── players.js        # Player CRUD
│   │   ├── games.js          # Game lifecycle + getFullGameState()
│   │   └── stats.js          # Aggregated statistics
│   ├── socket-handler.js     # Socket.IO event routing + game logic
│   ├── ai-engine.js          # AI player dart physics & strategy
│   └── checkout-table.js     # Double-out checkout lookup (static)
├── public/
│   ├── index.html            # Lobby: players + new game
│   ├── game.html             # Active game view
│   ├── stats.html            # Player statistics
│   ├── css/
│   │   └── app.css           # Custom styles (no CSS framework)
│   └── js/
│       ├── app.js            # Shared utilities, API client
│       ├── lobby.js          # Player management, game creation
│       ├── scoreboard.js     # Real-time score rendering
│       ├── input-pad.js      # Dart score input (numpad + segment selector)
│       ├── x01-view.js       # 501/301 specific UI
│       ├── cricket-view.js   # Cricket marks grid UI
│       └── stats-view.js     # Stats tables
└── data/                     # SQLite DB file (Docker volume mount)
    └── .gitkeep
```

---

## Data Model

### players
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| name | TEXT UNIQUE | Player display name |
| avatar_color | TEXT | Hex color (default #3b82f6) |
| is_ai | INTEGER | 0 or 1 |
| ai_level | INTEGER | 1-10 (null for human) |
| created_at | TEXT | ISO datetime |

### games
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| mode | TEXT | '501', '301', or 'cricket' |
| status | TEXT | 'in_progress', 'completed', 'abandoned' |
| winner_id | INTEGER FK | References players.id |
| settings | TEXT | JSON (e.g. double-in option) |
| created_at | TEXT | ISO datetime |
| finished_at | TEXT | ISO datetime |

### game_players
| Column | Type | Notes |
|--------|------|-------|
| game_id | INTEGER FK | References games.id |
| player_id | INTEGER FK | References players.id |
| position | INTEGER | Turn order (0, 1, 2...) |

### turns
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| game_id | INTEGER FK | References games.id |
| player_id | INTEGER FK | References players.id |
| round_num | INTEGER | 1-based round number |
| dart1 | TEXT | Encoded: "T20", "D16", "S5", "SB", "DB", "0" |
| dart2 | TEXT | Same encoding |
| dart3 | TEXT | Same encoding |
| score_total | INTEGER | Computed points for this turn |
| is_bust | INTEGER | 1 if busted (x01 only) |
| created_at | TEXT | ISO datetime |

**Dart encoding**: `S1`-`S20` (single), `D1`-`D20` (double), `T1`-`T20` (treble), `SB` (single bull 25), `DB` (double bull 50), `0` (miss)

### cricket_state
| Column | Type | Notes |
|--------|------|-------|
| game_id | INTEGER FK | References games.id |
| player_id | INTEGER FK | References players.id |
| marks_15 - marks_20 | INTEGER | 0-3+ marks per number |
| marks_bull | INTEGER | 0-3+ marks on bull |
| points | INTEGER | Running point total |

---

## API Endpoints

### REST (prefix: `/api`)

**Players**
- `GET /api/players` — List all players
- `POST /api/players` — Create player `{ name, avatar_color, is_ai, ai_level }`
- `PUT /api/players/:id` — Update player
- `DELETE /api/players/:id` — Delete player (only if no active games)

**Games**
- `GET /api/games` — List games (filter by `?status=`)
- `POST /api/games` — Create game `{ mode, player_ids, settings }`
- `GET /api/games/:id` — Full game state
- `DELETE /api/games/:id` — Abandon game

**Stats**
- `GET /api/stats/players/:id` — Player lifetime stats
- `GET /api/stats/games/:id` — Single game stats

### Socket.IO Events

**Client emits:**
- `join-game { gameId }` — Join game room
- `submit-turn { gameId, playerId, darts, scoreTotal }` — Submit turn
- `undo-turn { gameId }` — Undo last turn

**Server emits (to room):**
- `game-state { ...full state }` — After every state change
- `game-over { winnerId }` — Game finished
- `ai-thinking { playerId }` — AI is calculating

---

## UI Screens

### 1. Lobby (index.html)
- Add/remove players (colored badges) + AI opponents
- "New Game": pick mode (501/301/Cricket), select players
- Resume in-progress games list
- Large touch-friendly buttons throughout

### 2. Active Game — x01 (game.html)
- **Top**: Player names with remaining score in large font, active player highlighted with gold glow
- **Middle**: Throw history (last 3 turns per player), checkout suggestion banner
- **Bottom**: Input pad with two modes:
  - **Quick numpad**: Preset buttons (26, 41, 45, 60, 85, 100, 140, 180) + numeric keypad
  - **Dart-by-dart**: Segment selector (1-20, Bull) with Single/Double/Treble toggle
- Undo button, round counter, running averages

### 3. Active Game — Cricket (game.html)
- **Top**: Player columns with point totals
- **Middle**: Marks grid — rows for 20, 19, 18, 17, 16, 15, Bull with marks per player
- **Bottom**: Tap number (15-20/Bull) + multiplier, confirm turn
- Active player indicator, undo button

### 4. Game Over (overlay)
- Winner announcement with trophy
- Game summary stats (turns, averages)
- Buttons: Rematch / Back to Lobby

### 5. Stats (stats.html)
- Per-player career stats: games played, wins, win rate, x01 average, highest turn, 180s

**Design**: Mobile-first (Pixel 9 viewport), portrait primary, minimum touch targets, dark theme. Game page locked to viewport height (no scrolling).

---

## Deployment

### Docker
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

**Run**: `docker compose up -d --build` → open `http://localhost:8080`
**Local dev**: `npm install && npm run dev`

---

## Implementation Phases

### Phase 1 — Skeleton ✅
- [x] Project init: package.json, .gitignore, folder structure
- [x] Express server serving static files
- [x] SQLite setup with schema migrations on startup
- [x] Lobby page: player CRUD
- [x] Docker setup (working container)

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
- [x] AI opponents (10 difficulty levels with dart physics simulation)
- [x] Professional UI redesign (PDC broadcast theme, Oswald/Barlow fonts)
- [x] Mobile viewport optimization (Pixel 9, no scroll)
- [x] Bug fixes: rematch button, game-over overlay, hidden attribute

### Phase 4b — Enhanced Stats ✅
- [x] Filter AI players from stats page (human players only)
- [x] 3-dart average and first-9 average
- [x] Best leg (fewest darts to win)
- [x] Score milestones: 180s, 140+, 100+
- [x] Checkout percentage
- [x] Bust rate
- [x] Cricket stats section (games/wins/win rate)
- [x] Grouped stats layout (Overall, X01 Averages, X01 Scores, Cricket)

### Phase 4c — Sets & Legs ✅
- [x] Database schema: sets_won/legs_won on game_players, set_num/leg_num on turns
- [x] Game settings JSON: single, legs (bestOfLegs), sets (bestOfSets + bestOfLegsPerSet)
- [x] Game engine: leg win → increment legs_won, set win → increment sets_won, match win → game over
- [x] Score reset per leg (only current leg turns count for x01 score)
- [x] Starting player rotation per leg
- [x] Lobby UI: match format selector (Single Leg / Best of Legs / Sets) with options
- [x] Scoreboard: sets/legs badges per player, dart icon for starting player
- [x] Game header: shows format in mode label (e.g. "501 Bo5")
- [x] Rematch carries forward match settings

### Phase 4d — Dynamic Throw Suggestions ✅
- [x] New `throw-suggestions.js` engine — pure logic, no DOM
- [x] Skill tiers based on 3-dart average (beginner/club/good/advanced)
- [x] Scoring phase (>300): aim area + turn target based on tier
- [x] Setup phase (171-300): suggests score to leave preferred double
- [x] Checkout phase (≤170): standard checkout hints
- [x] Safety mode: safer checkout paths for players with >20% bust rate
- [x] First-9 average shown in opening rounds
- [x] Post-bust encouragement ("Steady. Aim for X+")
- [x] Color-coded strip: blue (scoring), gold (setup), red (checkout), green (safety)
- [x] Player stats fetched once on game load, cached client-side
- [x] Hidden for AI players, graceful fallback when no stats available

### Phase 4e — Bogey Number Warning System ✅
- [x] Bogey numbers array: 169, 168, 166, 165, 163, 162, 159
- [x] Quick numpad: warns as digits are typed ("120 ⚠ leaves 169")
- [x] Dart-by-dart: warns as darts are entered with running subtotal
- [x] Red border + flash animation on input area when bogey detected
- [x] Bogey tag badge in dart-by-dart display

### Phase 4f — Mid-Turn Checkout Recalculation ✅
- [x] Suggestion strip updates after each dart in dart-by-dart mode
- [x] Recalculates checkout path from remaining score (score - subtotal)
- [x] Shows "Finish: D20 (40 left)" on last dart, "Checkout: T20 D10 (80 left)" on 2nd
- [x] Shows "Game shot!" when remaining hits 0, "BUST" when below 0 or at 1

### Phase 5 — Future Enhancements
- [ ] Google Account authentication (see `GOOGLE-AUTH-SETUP.md`)
- [ ] Remote Play via WebRTC — peer-to-peer video feed of dartboards with synced scoreboard, using Socket.IO as signaling server and Cloudflare Tunnel for internet exposure (see `REMOTE-PLAY.md`)
- [ ] Momentum Graph — post-match line chart showing score gap over turns, like chess advantage bar. Chart.js via CDN on game-over overlay and stats page (see `MOMENTUM-GRAPH.md`)
- [x] Animation Overlay System — GSAP + Canvas-Confetti for 180s, ton+, game shots, busts
- [x] Sound effects (180, checkout, game win) — Web Audio API synthesized, synced with animations
- [ ] Dartboard SVG as input method
- [ ] PWA support (offline, "Add to Home Screen")
- [ ] Game history export (CSV)
- [ ] Head-to-head records in stats
- [ ] GitHub Actions CI/CD for Docker image builds
