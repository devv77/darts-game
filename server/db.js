const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'darts.db'));

// Performance settings
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Schema migrations
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL UNIQUE,
    avatar_color TEXT DEFAULT '#3b82f6',
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    mode        TEXT NOT NULL CHECK (mode IN ('501', '301', 'cricket')),
    status      TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
    winner_id   INTEGER REFERENCES players(id),
    settings    TEXT DEFAULT '{}',
    created_at  TEXT DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS game_players (
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    position    INTEGER NOT NULL,
    PRIMARY KEY (game_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS turns (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    round_num   INTEGER NOT NULL,
    dart1       TEXT,
    dart2       TEXT,
    dart3       TEXT,
    score_total INTEGER NOT NULL DEFAULT 0,
    is_bust     INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cricket_state (
    game_id     INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id   INTEGER NOT NULL REFERENCES players(id),
    marks_15    INTEGER NOT NULL DEFAULT 0,
    marks_16    INTEGER NOT NULL DEFAULT 0,
    marks_17    INTEGER NOT NULL DEFAULT 0,
    marks_18    INTEGER NOT NULL DEFAULT 0,
    marks_19    INTEGER NOT NULL DEFAULT 0,
    marks_20    INTEGER NOT NULL DEFAULT 0,
    marks_bull  INTEGER NOT NULL DEFAULT 0,
    points      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (game_id, player_id)
  );
`);

// AI player columns migration (safe for existing DBs)
try { db.exec('ALTER TABLE players ADD COLUMN is_ai INTEGER NOT NULL DEFAULT 0'); } catch (e) { /* column exists */ }
try { db.exec('ALTER TABLE players ADD COLUMN ai_level INTEGER DEFAULT NULL'); } catch (e) { /* column exists */ }

module.exports = db;
