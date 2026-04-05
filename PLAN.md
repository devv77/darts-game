# Darts Counter - Application Plan

A self-hosted web application for tracking darts games. Run it with `docker compose up` or `npm start` and open your browser.

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Backend | Node.js + Express + Socket.IO | Simple, no build step, real-time updates via WebSocket |
| Frontend | Vanilla JS + Pico CSS | No framework overhead, mobile-friendly out of the box |
| Database | SQLite (better-sqlite3) | Zero config, single file, no external DB needed |
| Deployment | Docker (single container) | `docker compose up -d` and done |

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
├── server/
│   ├── index.js              # Express + Socket.IO entry point
│   ├── db.js                 # SQLite connection + schema migrations
│   ├── routes/
│   │   ├── players.js        # Player CRUD
│   │   ├── games.js          # Game lifecycle
│   │   └── stats.js          # Aggregated statistics
│   ├── game-engines/
│   │   ├── base-engine.js    # Shared turn/round logic
│   │   ├── x01-engine.js     # 501/301 scoring, bust, double-out
│   │   └── cricket-engine.js # Marks, points, close/win detection
│   ├── socket-handler.js     # Socket.IO event routing
│   └── checkout-table.js     # Double-out checkout lookup (static)
├── public/
│   ├── index.html            # Lobby: players + new game
│   ├── game.html             # Active game view
│   ├── stats.html            # Player statistics
│   ├── css/
│   │   └── app.css           # Custom styles on top of Pico CSS
│   └── js/
│       ├── app.js            # Shared utilities, socket init
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
- `POST /api/players` — Create player `{ name, avatar_color }`
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
- `submit-turn { gameId, playerId, darts: ["T20","T20","T20"] }` — Submit turn
- `undo-turn { gameId }` — Undo last turn

**Server emits (to room):**
- `game-state { ...full state }` — After every state change
- `turn-recorded { turn, newScore, checkout }` — Turn confirmation
- `game-over { winnerId, stats }` — Game finished

---

## UI Screens

### 1. Lobby (index.html)
- Add/edit/remove players (colored badges)
- "New Game" button: pick mode (501/301/Cricket), select players, optional settings
- Resume in-progress games list
- Large touch-friendly buttons throughout

### 2. Active Game — x01 (game.html)
- **Top**: Player names with remaining score in large font, active player highlighted
- **Middle**: Current turn — darts thrown so far, running subtotal
- **Bottom**: Input pad with two modes:
  - **Quick numpad**: Preset buttons (26, 41, 45, 60, 85, 100, 140, 180) + numeric keypad
  - **Dart-by-dart**: Segment selector (1-20, Bull) with Single/Double/Treble toggle
- Checkout suggestion banner when score <= 170
- Undo button, round counter, running averages

### 3. Active Game — Cricket (game.html)
- **Top**: Player columns with point totals
- **Middle**: Marks grid — rows for 20, 19, 18, 17, 16, 15, Bull with marks per player
- **Bottom**: Tap number (15-20/Bull) + multiplier, confirm turn
- Active player indicator, undo button

### 4. Game Over (overlay)
- Winner announcement
- Game summary stats
- Buttons: Rematch / New Game / Back to Lobby

### 5. Stats (stats.html)
- Per-player career stats: win rate, x01 average, best leg
- Head-to-head records
- Recent game history

**Design**: Mobile-first, portrait primary, minimum 48x48px touch targets, dark theme default.

---

## Deployment

### Docker
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3000
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
CMD ["node", "server/index.js"]
```

```yaml
# docker-compose.yml
services:
  darts:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - darts-data:/app/data
    restart: unless-stopped

volumes:
  darts-data:
```

**Run**: `docker compose up -d` → open `http://localhost:3000`
**Local dev**: `npm install && npm start`

---

## Implementation Phases

### Phase 1 — Skeleton
- Project init: package.json, .gitignore, folder structure
- Express server serving static files
- SQLite setup with schema migrations on startup
- Lobby page: player CRUD
- Docker setup (working container early)

### Phase 2 — 501 Game Mode
- x01-engine: scoring, bust detection, double-out validation, win detection
- Checkout table (static lookup for scores 2-170)
- Game creation + turn submission APIs
- Socket.IO: room management, state broadcast
- x01 game UI: scoreboard, quick numpad input, checkout suggestions
- Undo functionality

### Phase 3 — Cricket Game Mode
- cricket-engine: marks tracking, point scoring, close detection, win condition
- Cricket state persistence
- Cricket UI: marks grid, number input
- Reuse socket infrastructure from Phase 2

### Phase 4 — Stats & Polish
- Stats aggregation queries
- Stats page UI
- Game over overlay with rematch
- Dart-by-dart input mode for x01
- CSS polish, animations, dark mode

### Phase 5 — Optional Enhancements (future)
- Sound effects (180, checkout, game win)
- Dartboard SVG as input method
- PWA support (offline, "Add to Home Screen")
- Game history export (CSV)
- GitHub Actions CI/CD for Docker image builds
