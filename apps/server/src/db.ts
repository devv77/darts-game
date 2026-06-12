import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'darts.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

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

  CREATE TABLE IF NOT EXISTS sessions (
    token       TEXT PRIMARY KEY,
    player_id   INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at  TEXT DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

  CREATE TABLE IF NOT EXISTS practice_sessions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id            INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    drill_type           TEXT NOT NULL,
    difficulty           TEXT,
    targets_json         TEXT NOT NULL,
    results_json         TEXT NOT NULL DEFAULT '[]',
    current_index        INTEGER NOT NULL DEFAULT 0,
    current_target_darts INTEGER NOT NULL DEFAULT 0,
    total_successes      INTEGER NOT NULL DEFAULT 0,
    scoring_total        INTEGER NOT NULL DEFAULT 0,
    darts_thrown         INTEGER NOT NULL DEFAULT 0,
    started_at           TEXT DEFAULT (datetime('now')),
    finished_at          TEXT
  );

  CREATE TABLE IF NOT EXISTS practice_history (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id     INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    drill_type    TEXT NOT NULL,
    difficulty    TEXT,
    metric_name   TEXT NOT NULL,
    metric_value  REAL NOT NULL,
    session_date  TEXT DEFAULT (datetime('now'))
  );

  -- Phase 9 — Tournament Mode: a meta-layer that orchestrates ordinary games.
  CREATE TABLE IF NOT EXISTS tournaments (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT NOT NULL,
    format         TEXT NOT NULL CHECK (format IN ('knockout','league','groups_knockout')),
    mode           TEXT NOT NULL CHECK (mode IN ('501','301','cricket')),
    match_settings TEXT NOT NULL DEFAULT '{}',
    options        TEXT NOT NULL DEFAULT '{}',
    status         TEXT NOT NULL DEFAULT 'setup' CHECK (status IN ('setup','in_progress','completed','abandoned')),
    is_online      INTEGER NOT NULL DEFAULT 0,
    winner_id      INTEGER REFERENCES players(id),
    created_by     INTEGER REFERENCES players(id),
    created_at     TEXT DEFAULT (datetime('now')),
    finished_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS tournament_players (
    tournament_id  INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    player_id      INTEGER NOT NULL REFERENCES players(id),
    seed           INTEGER NOT NULL,
    group_label    TEXT,
    eliminated     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tournament_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS tournament_matches (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tournament_id   INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    game_id         INTEGER REFERENCES games(id) ON DELETE SET NULL,
    stage           TEXT NOT NULL,
    group_label     TEXT,
    round_num       INTEGER NOT NULL,
    match_index     INTEGER NOT NULL,
    home_player_id  INTEGER REFERENCES players(id),
    away_player_id  INTEGER REFERENCES players(id),
    home_legs       INTEGER NOT NULL DEFAULT 0,
    away_legs       INTEGER NOT NULL DEFAULT 0,
    winner_id       INTEGER REFERENCES players(id),
    status          TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','ready','in_progress','completed','bye')),
    next_match_id   INTEGER REFERENCES tournament_matches(id),
    next_slot       TEXT CHECK (next_slot IN ('home','away')),
    created_at      TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tmatch_tournament ON tournament_matches(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_tmatch_game ON tournament_matches(game_id);
`);

const safeAlter = (sql: string) => {
  try { db.exec(sql); } catch { /* column exists */ }
};

safeAlter('ALTER TABLE players ADD COLUMN is_ai INTEGER NOT NULL DEFAULT 0');
safeAlter('ALTER TABLE players ADD COLUMN ai_level INTEGER DEFAULT NULL');
safeAlter('ALTER TABLE players ADD COLUMN google_id TEXT');
safeAlter('ALTER TABLE players ADD COLUMN email TEXT');
safeAlter('ALTER TABLE players ADD COLUMN avatar_url TEXT');
safeAlter('CREATE UNIQUE INDEX idx_players_google_id ON players(google_id) WHERE google_id IS NOT NULL');
safeAlter('ALTER TABLE game_players ADD COLUMN sets_won INTEGER NOT NULL DEFAULT 0');
safeAlter('ALTER TABLE game_players ADD COLUMN legs_won INTEGER NOT NULL DEFAULT 0');
safeAlter('ALTER TABLE turns ADD COLUMN set_num INTEGER NOT NULL DEFAULT 1');
safeAlter('ALTER TABLE turns ADD COLUMN leg_num INTEGER NOT NULL DEFAULT 1');
safeAlter('ALTER TABLE turns ADD COLUMN cricket_points INTEGER NOT NULL DEFAULT 0');
// Phase 8a — online multiplayer: invite-code join + live-online flag.
safeAlter('ALTER TABLE games ADD COLUMN invite_code TEXT');
safeAlter('ALTER TABLE games ADD COLUMN is_online INTEGER NOT NULL DEFAULT 0');
safeAlter('CREATE UNIQUE INDEX idx_games_invite_code ON games(invite_code) WHERE invite_code IS NOT NULL');
// Phase 9 T5 — online tournaments: code-join during a `setup` lobby, target seat count.
safeAlter('ALTER TABLE tournaments ADD COLUMN invite_code TEXT');
safeAlter('ALTER TABLE tournaments ADD COLUMN target_size INTEGER');
safeAlter('CREATE UNIQUE INDEX idx_tournaments_invite_code ON tournaments(invite_code) WHERE invite_code IS NOT NULL');

const SCHEMA_VERSION = 1;
const currentVersion = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
if (currentVersion < 1) {
  const localPlayers = db.prepare(
    "SELECT COUNT(*) as c FROM players WHERE is_ai = 0 AND google_id IS NULL"
  ).get() as { c: number };
  if (localPlayers.c > 0) {
    db.transaction(() => {
      db.exec('DELETE FROM sessions');
      db.exec('DELETE FROM cricket_state');
      db.exec('DELETE FROM turns');
      db.exec('DELETE FROM game_players');
      db.exec('DELETE FROM games');
      db.exec('DELETE FROM players WHERE is_ai = 0 AND google_id IS NULL');
    })();
    console.log(`[migration v1] wiped ${localPlayers.c} pre-Google local player(s) and all their game data`);
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}

const AI_COLORS = [
  '#22c55e', '#4ade80', '#84cc16', '#eab308', '#f59e0b',
  '#f97316', '#ef4444', '#dc2626', '#b91c1c', '#7f1d1d',
];
const AI_NAMES = [
  'AI - Beginner', 'AI - Novice', 'AI - Casual', 'AI - Pub Player',
  'AI - Club Player', 'AI - League', 'AI - County', 'AI - Semi-Pro',
  'AI - Pro', 'AI - World Class',
];

const insertAi = db.prepare(
  'INSERT OR IGNORE INTO players (name, avatar_color, is_ai, ai_level) VALUES (?, ?, 1, ?)'
);
for (let i = 0; i < 10; i++) {
  insertAi.run(AI_NAMES[i], AI_COLORS[i], i + 1);
}

const preseededNames = new Set(AI_NAMES);
const oldAiPlayers = db.prepare('SELECT id, name FROM players WHERE is_ai = 1').all() as { id: number; name: string }[];
for (const p of oldAiPlayers) {
  if (!preseededNames.has(p.name)) {
    const hasGames = db.prepare(
      'SELECT COUNT(*) as c FROM game_players WHERE player_id = ?'
    ).get(p.id) as { c: number };
    if (hasGames.c === 0) {
      db.prepare('DELETE FROM players WHERE id = ?').run(p.id);
    }
  }
}
