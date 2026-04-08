 Practice Mode — Implementation Plan                                                                                                                                                                                                                                                                                 
                                                                                                                                                                                                                                                                                                                     
 Context

 Players need a way to train specific skills (checkouts, scoring, doubles) without playing a full competitive game. Practice Mode is a solo training system with 4 drill types, progress tracking, and integration with existing animations/voice/suggestions.

 4 Drill Types

 1. Checkout Practice

 - 10 random checkout targets from difficulty range (Easy: 2-40, Medium: 41-100, Hard: 101-170)
 - Dart-by-dart input (forced — need to verify double finish)
 - 3 darts max per target. Success = reach 0 on a double. Fail = bust or darts exhausted
 - Reuses existing checkoutHints table for suggestions
 - Tracks: success rate, avg darts per checkout

 2. Scoring Practice

 - 10 rounds of pure scoring (numpad input, no bust rules)
 - Tracks running average, compares to lifetime x01_average
 - Goal: beat your personal average
 - Existing animations fire on 180s, ton+ etc.

 3. Around the Board

 - Hit 1-20 + Bull in sequence (any segment: S/D/T all count)
 - Dart-by-dart input. Multiple targets can be hit in one turn
 - Tracks: total darts thrown, time to complete
 - Visual progress bar showing 21 targets

 4. Double Practice

 - 10 random doubles (D1-D20 + DB)
 - Dart-by-dart input. Up to 9 darts (3 turns) per target
 - Tracks: hit rate, per-double performance for weakness heatmap

 Database Changes (server/db.js)

 -- Relax games.mode CHECK to allow practice modes
 -- (validate in API route instead)

 CREATE TABLE IF NOT EXISTS practice_sessions (
   id              INTEGER PRIMARY KEY AUTOINCREMENT,
   game_id         INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
   player_id       INTEGER NOT NULL REFERENCES players(id),
   drill_type      TEXT NOT NULL,
   difficulty      TEXT,
   targets_json    TEXT NOT NULL,
   results_json    TEXT DEFAULT '[]',
   current_index   INTEGER DEFAULT 0,
   total_attempts  INTEGER DEFAULT 0,
   total_successes INTEGER DEFAULT 0,
   started_at      TEXT DEFAULT (datetime('now')),
   finished_at     TEXT,
   UNIQUE(game_id)
 );

 CREATE TABLE IF NOT EXISTS practice_history (
   id            INTEGER PRIMARY KEY AUTOINCREMENT,
   player_id     INTEGER NOT NULL REFERENCES players(id),
   drill_type    TEXT NOT NULL,
   difficulty    TEXT,
   metric_name   TEXT NOT NULL,
   metric_value  REAL NOT NULL,
   session_date  TEXT DEFAULT (datetime('now'))
 );

 New Files

 - server/routes/practice.js — API: create session, get state, get history
 - public/js/practice-view.js — render drills, handle practice turns

 Modified Files

 - server/db.js — new tables, relax mode CHECK
 - server/index.js — register practice routes
 - server/socket-handler.js — add submit-practice-turn event
 - server/routes/games.js — accept practice_* modes in validation
 - public/index.html — practice section in lobby (4 drill buttons + options)
 - public/js/lobby.js — drill selection, difficulty, start practice
 - public/game.html — practice header elements, load practice-view.js
 - public/js/x01-view.js — route practice modes to practice-view
 - public/css/app.css — drill button cards, target display, progress bar styles
 - public/js/stats-view.js — practice history section

 Lobby UI

 4 drill cards in a 2x2 grid with icon + name + description. Selecting one shows:
 - Difficulty picker (checkout/doubles only)
 - Player selector (single human)
 - Start Practice button

 Game Page

 Reuses existing layout. Practice-specific header replaces scoreboard:
 - Drill title + target display (large, prominent)
 - Progress: "Attempt 3/10" or "Target: 14" with progress bar
 - Suggestion strip: checkout paths, average comparison, target hint

 Input area reused as-is:
 - Dart-by-dart for checkout/ATB/doubles (forced, toggle hidden)
 - Quick numpad for scoring (default)

 Socket Flow

 - submit-practice-turn → validates per drill rules → inserts turn → updates practice_sessions → broadcasts state
 - Reuses join-game for state recovery on reconnect
 - Practice games use practice_checkout etc as mode value

 Stats Integration

 - Practice games excluded from competitive stats (mode filter IN ('501','301') already handles this)
 - Practice history endpoint: GET /api/practice/history/:playerId
 - Stats page gets new "Practice" section showing trends per drill type

 Implementation Order

 1. Database: new tables + relax CHECK
 2. Backend: practice.js routes + socket handler
 3. Game page: practice-view.js + routing
 4. Lobby: drill selection UI
 5. CSS: practice styles
 6. Stats: practice history display

 Verification

 1. Start each drill type from lobby, verify correct input mode
 2. Checkout: complete a target, verify success/fail tracking
 3. Scoring: play 10 rounds, verify average calculation
 4. ATB: hit targets in sequence, verify multi-target turns work
 5. Doubles: verify exact double matching
 6. Check that practice games don't affect competitive stats
 7. Verify animations/voice fire during practice
 8. Test on Pixel 9 viewport