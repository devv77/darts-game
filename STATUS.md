# Darts Counter — Project Status

Last updated: 2026-04-09

---

## Codebase Overview

| Category | Files | Lines |
|----------|-------|-------|
| Frontend JS | 9 | ~1,620 |
| Backend JS | 6 | ~1,460 |
| CSS | 1 | ~1,800 |
| **Total** | **16** | **~4,880** |

**Stack:** Node.js + Express + Socket.IO + SQLite (better-sqlite3) | Vanilla JS frontend | Docker deployment

**External CDN:** GSAP (animations), Canvas-Confetti, Google Fonts (Oswald, Barlow)

---

## Server Functions

### index.js — Entry Point
- Express server on port 3000, serves static files + SPA routes

### routes/players.js — Player CRUD
- `GET /api/players` — list all
- `POST /api/players` — create (name, color, optional AI)
- `PUT /api/players/:id` — update
- `DELETE /api/players/:id` — delete (blocked if active games)

### routes/games.js — Game Lifecycle
- `GET /api/games` — list (optional `?status=` filter)
- `POST /api/games` — create with mode, player_ids, settings
- `GET /api/games/:id` — full state via `getFullGameState()`
- `DELETE /api/games/:id` — delete game + cascading data
- **`getFullGameState(gameId)`** — aggregates game, players, turns, scores, set/leg state, current player

### routes/stats.js — Statistics
- `GET /api/stats/players/:id` — lifetime stats (true 3-dart avg, first-9, best leg, 180s, bust rate, checkout %)
- `GET /api/stats/games/:id` — per-game stats with player breakdowns

### socket-handler.js — Real-Time Game Logic
- `join-game` — joins room, sends state point-to-point, triggers AI
- `submit-turn` — validates + persists turn, detects bust/checkout, handles legs/sets progression
- `undo-turn` — reverts last turn, reopens completed games
- **`handleX01Turn()`** — score calculation, bust detection, leg/set win logic
- **`handleLegWin()`** — increments legs/sets, checks match win
- **`handleCricketTurn()`** — marks tracking, point scoring, close/win detection
- **`checkAndTriggerAiTurn()`** — 1-3s delayed AI with duplicate guard

### ai-engine.js — 10-Level AI
- `generateAiTurn()` — produces 3 darts based on level + game mode
- Dart physics simulation: accuracy, treble rate, scatter, miss rate
- X01 strategy: follows checkout table, adjusts scoring target by level
- Cricket strategy: defensive/offensive number selection by level

### checkout-table.js — 169-Entry Lookup
- `getCheckout(score)` — optimal finish for scores 2-170

### db.js — SQLite Schema
- 5 tables: players, games, game_players, turns, cricket_state
- WAL mode, foreign keys, safe migrations
- Pre-seeds 10 AI players on startup

---

## Frontend Functions

### app.js — Shared Utilities
- `API.get/post/put/del()` — fetch wrappers
- `parseDartScore(dart)` — notation → number
- `formatDart(dart)` — notation → display string
- `getGameIdFromURL()` — URL param extraction

### lobby.js — Game Lobby
- Player management (add/delete, human only in list)
- AI opponent dropdown (pre-seeded levels 1-10)
- Game creation with mode, format (single/legs/sets), player selection
- Active games list with resume/abandon

### x01-view.js — 501/301 Game View
- `renderX01Game()` — main render: scoreboard, presets, suggestions, history
- `updatePresets()` — dynamic skill-tier buttons with checkout highlight
- `submitQuickScore()` — numpad score submission
- `showGameOver()` — overlay with stats + rematch
- `requestWakeLock()` — screen wake lock + reconnect on visibility change
- Socket reconnection: re-joins room on `connect` event

### input-pad.js — Dart-by-Dart Input
- `initDartByDart()` — multiplier + number grid bindings
- `renderDartsDisplay()` — current darts + running subtotal
- Mid-turn bogey warning + checkout recalculation

### scoreboard.js — Score Display
- `renderX01Scoreboard()` — scores, true 3-dart avg, sets/legs badges, starting player indicator
- `renderCricketScoreboard()` — point totals per player
- Active player tinted with `--player-color`

### throw-suggestions.js — Suggestion Engine (Pure Logic)
- `getSuggestion(score, stats, ctx)` — contextual advice by game phase
- `getPresets(score, stats)` — dynamic preset buttons by skill tier
- `checkBogey(remaining)` — bogey number detection
- Full 169-entry checkout table + safer alternatives for bust-prone players
- Skill tiers: beginner (<35), club (35-55), good (55-75), advanced (75+)

### cricket-view.js — Cricket Game View
- `renderCricketGame()` — marks grid + input
- `renderCricketGrid()` — table with /, X, O marks per player

### animation-system.js — Visual + Audio Effects
- `triggerThrowAnimation(score, isCheckout)` — routes to animation
- **180:** Scale + shake + confetti + rising fanfare
- **Ton+ (100-179):** Slide banner + chime
- **Game Shot:** Elastic text + massive confetti + victory fanfare
- **Bust:** Stamp effect + descending buzz
- Debug panel: triple-tap mode badge

### stats-view.js — Stats Page
- Filters AI players (human only)
- Sections: Overall, X01 Averages, X01 Scores, Cricket

---

## Completed Features

- [x] 501/301/Cricket game modes
- [x] 10-level AI opponents with dart physics
- [x] Sets & Legs match formats (single, best-of-legs, best-of-sets)
- [x] Real-time Socket.IO with reconnection recovery
- [x] Dynamic throw suggestions (skill-tier personalized)
- [x] Complete checkout table (169 scores)
- [x] Bogey number warnings (real-time in both input modes)
- [x] Mid-turn checkout recalculation (dart-by-dart)
- [x] Dynamic preset buttons (context + skill aware)
- [x] True 3-dart average (actual darts, not assumed 3)
- [x] Player stats: first-9 avg, best leg, 180s, bust rate, checkout %
- [x] Animation overlays (GSAP) + sound effects (Web Audio API)
- [x] Active player color theming (entire UI shifts)
- [x] Screen wake lock (keeps display on)
- [x] Responsive design (phones → tablets)
- [x] PDC broadcast dark theme
- [x] Undo functionality
- [x] Game deletion (cascade cleanup)
- [x] Docker deployment

---

## Future Enhancements

### High Impact
- [ ] **Google OAuth** — sign in with Google, stats tied to account, profile pictures (`GOOGLE-AUTH-SETUP.md`)
- [ ] **Momentum Graph** — post-match line chart (Chart.js) showing score gap over turns (`MOMENTUM-GRAPH.md`)
- [ ] **Remote Play** — WebRTC video feed + synced scoreboard over internet (`REMOTE-PLAY.md`)
- [ ] **PWA Support** — offline play, "Add to Home Screen", service worker caching

### Medium Impact
- [ ] **Bull Throw Starting Order** — throw at bull to determine who starts, manual switch option
- [ ] **Dartboard SVG Input** — tap segments on a visual dartboard instead of number grid
- [ ] **Head-to-Head Records** — player vs player lifetime win/loss stats
- [ ] **Game History Export** — CSV download of game data and stats

### Nice to Have
- [ ] **GitHub Actions CI/CD** — automated Docker image builds on push
- [ ] **Haptic Feedback** — vibrate on significant scores (mobile)
- [ ] **Custom Game Modes** — configurable starting score (e.g., 701, 1001)
- [ ] **Tournament Bracket** — multi-round elimination or round-robin format
- [ ] **Voice Announcements** — Web Speech API for "one hundred and eighty!" callouts
- [ ] **Theme Customization** — light theme, custom accent colors, PDC/BDO/WDF themes
- [ ] **Spectator Mode** — read-only game view with live scores for audience
- [ ] **Practice Mode** — solo training with target drills and stat tracking
