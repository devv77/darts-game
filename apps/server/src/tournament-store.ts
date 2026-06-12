import { db } from './db.js';
import { sanitizePlayer } from './sanitize.js';
import { generateKnockout, type GeneratedMatch } from './tournament-engine.js';
import type {
  GameMode, MatchSettings, Player,
  TournamentFormat, TournamentMatchRow, TournamentOptions, TournamentRow,
} from './types.js';

export interface CreateTournamentInput {
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  matchSettings: MatchSettings;
  options: TournamentOptions;
  playerIds: number[]; // in seed order (seed 1 first)
  isOnline?: boolean;
  targetSize?: number; // online only: total seats to fill before the bracket starts
  createdBy: number;
}

// Crockford-ish alphabet (no 0/O/1/I/L), shared shape with Phase 8a game codes.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function generateTournamentInviteCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < 5; i++) code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM tournaments WHERE invite_code = ?').get(code)) return code;
  }
  throw new Error('Could not allocate a unique invite code');
}

// ── client-facing (camelCase) shapes — the lib/tournaments.ts contract ──────
export interface TournamentMatchDto {
  id: number;
  tournamentId: number;
  gameId: number | null;
  stage: string;
  groupLabel: string | null;
  roundNum: number;
  matchIndex: number;
  homePlayerId: number | null;
  awayPlayerId: number | null;
  homeLegs: number;
  awayLegs: number;
  winnerId: number | null;
  status: string;
  nextMatchId: number | null;
  nextSlot: 'home' | 'away' | null;
}

export interface TournamentPlayerDto {
  player: Player;
  seed: number;
  groupLabel: string | null;
  eliminated: boolean;
}

export interface TournamentStateDto {
  id: number;
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  status: string;
  isOnline: boolean;
  inviteCode: string | null;
  targetSize: number | null;
  matchSettings: MatchSettings;
  options: TournamentOptions;
  winnerId: number | null;
  createdBy: number | null;
  players: TournamentPlayerDto[];
  matches: TournamentMatchDto[];
  createdAt: string;
  finishedAt: string | null;
}

function matchToDto(m: TournamentMatchRow): TournamentMatchDto {
  return {
    id: m.id,
    tournamentId: m.tournament_id,
    gameId: m.game_id,
    stage: m.stage,
    groupLabel: m.group_label,
    roundNum: m.round_num,
    matchIndex: m.match_index,
    homePlayerId: m.home_player_id,
    awayPlayerId: m.away_player_id,
    homeLegs: m.home_legs,
    awayLegs: m.away_legs,
    winnerId: m.winner_id,
    status: m.status,
    nextMatchId: m.next_match_id,
    nextSlot: m.next_slot,
  };
}

export function createTournament(input: CreateTournamentInput): number {
  const { name, format, mode, matchSettings, options, playerIds, isOnline, targetSize, createdBy } = input;
  if (format !== 'knockout') {
    // League / groups land in T2 / T3; only knockout is wired end-to-end.
    throw new Error('Only knockout tournaments are available right now');
  }

  const create = db.transaction(() => {
    // Online tournaments open in a `setup` lobby: only the host is seeded, the
    // rest join by code, and the bracket is generated at start. Single-device
    // tournaments fix the roster up front and generate the bracket immediately.
    const status = isOnline ? 'setup' : 'in_progress';
    const inviteCode = isOnline ? generateTournamentInviteCode() : null;
    const result = db.prepare(
      `INSERT INTO tournaments (name, format, mode, match_settings, options, status, is_online, invite_code, target_size, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      name, format, mode, JSON.stringify(matchSettings), JSON.stringify(options),
      status, isOnline ? 1 : 0, inviteCode, isOnline ? (targetSize ?? null) : null, createdBy
    );
    const tournamentId = result.lastInsertRowid as number;

    const insertPlayer = db.prepare(
      'INSERT INTO tournament_players (tournament_id, player_id, seed) VALUES (?, ?, ?)'
    );
    playerIds.forEach((pid, i) => insertPlayer.run(tournamentId, pid, i + 1));

    if (!isOnline) {
      persistGeneratedMatches(tournamentId, generateKnockout(playerIds));
    }
    return tournamentId;
  });

  return create();
}

/** Add a player to a `setup` online tournament by its invite code. Auto-starts
 *  the bracket once the target seat count is reached. Returns the tournament id. */
export function joinTournamentByCode(code: string, playerId: number): number {
  const t = db.prepare('SELECT * FROM tournaments WHERE invite_code = ?').get(code) as TournamentRow | undefined;
  if (!t || !t.is_online) throw Object.assign(new Error('No open tournament found for that code'), { statusCode: 404 });
  if (t.status !== 'setup') throw Object.assign(new Error('That tournament has already started'), { statusCode: 409 });
  if (isTournamentParticipant(t.id, playerId)) return t.id; // idempotent

  const count = (db.prepare('SELECT COUNT(*) c FROM tournament_players WHERE tournament_id = ?').get(t.id) as { c: number }).c;
  if (t.target_size && count >= t.target_size) {
    throw Object.assign(new Error('That tournament is full'), { statusCode: 409 });
  }
  db.prepare('INSERT INTO tournament_players (tournament_id, player_id, seed) VALUES (?, ?, ?)')
    .run(t.id, playerId, count + 1);

  if (t.target_size && count + 1 >= t.target_size) startTournament(t.id);
  return t.id;
}

/** Generate the bracket from the joined roster and flip a `setup` tournament to in_progress. */
export function startTournament(tournamentId: number): void {
  const t = getTournamentRow(tournamentId);
  if (!t) throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
  if (t.status !== 'setup') throw Object.assign(new Error('Tournament already started'), { statusCode: 409 });
  const players = db.prepare(
    'SELECT player_id FROM tournament_players WHERE tournament_id = ? ORDER BY seed'
  ).all(tournamentId) as { player_id: number }[];
  if (players.length < 2) throw Object.assign(new Error('Need at least 2 players to start'), { statusCode: 400 });

  db.transaction(() => {
    persistGeneratedMatches(tournamentId, generateKnockout(players.map((p) => p.player_id)));
    db.prepare("UPDATE tournaments SET status = 'in_progress' WHERE id = ?").run(tournamentId);
  })();
}

/** Insert generated matches, then wire next_match_id from the tempId map. */
function persistGeneratedMatches(tournamentId: number, generated: GeneratedMatch[]): void {
  const insert = db.prepare(
    `INSERT INTO tournament_matches
       (tournament_id, stage, group_label, round_num, match_index,
        home_player_id, away_player_id, winner_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const tempToReal = new Map<number, number>();
  for (const m of generated) {
    const r = insert.run(
      tournamentId, m.stage, m.groupLabel, m.roundNum, m.matchIndex,
      m.homePlayerId, m.awayPlayerId, m.winnerId, m.status
    );
    tempToReal.set(m.tempId, r.lastInsertRowid as number);
  }
  const wire = db.prepare('UPDATE tournament_matches SET next_match_id = ?, next_slot = ? WHERE id = ?');
  for (const m of generated) {
    if (m.nextTempId === null) continue;
    wire.run(tempToReal.get(m.nextTempId)!, m.nextSlot, tempToReal.get(m.tempId)!);
  }
}

export function getTournamentRow(id: number | string): TournamentRow | undefined {
  return db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as TournamentRow | undefined;
}

export function getTournamentState(id: number | string, viewer: Player | null | undefined): TournamentStateDto | null {
  const t = getTournamentRow(id);
  if (!t) return null;

  const playerRows = db.prepare(
    `SELECT tp.seed, tp.group_label, tp.eliminated, p.*
     FROM tournament_players tp JOIN players p ON p.id = tp.player_id
     WHERE tp.tournament_id = ? ORDER BY tp.seed`
  ).all(t.id) as (Player & { seed: number; group_label: string | null; eliminated: number })[];

  const players: TournamentPlayerDto[] = playerRows.map((row) => {
    const { seed, group_label, eliminated, ...player } = row;
    return {
      player: sanitizePlayer(player as Player, viewer),
      seed,
      groupLabel: group_label,
      eliminated: !!eliminated,
    };
  });

  const matches = (db.prepare(
    'SELECT * FROM tournament_matches WHERE tournament_id = ? ORDER BY round_num, match_index'
  ).all(t.id) as TournamentMatchRow[]).map(matchToDto);

  return {
    id: t.id,
    name: t.name,
    format: t.format,
    mode: t.mode,
    status: t.status,
    isOnline: !!t.is_online,
    inviteCode: t.invite_code,
    targetSize: t.target_size,
    matchSettings: JSON.parse(t.match_settings || '{}'),
    options: JSON.parse(t.options || '{}'),
    winnerId: t.winner_id,
    createdBy: t.created_by,
    players,
    matches,
    createdAt: t.created_at,
    finishedAt: t.finished_at,
  };
}

export function listTournaments(viewer: Player, isAdminViewer: boolean, status?: string): TournamentRow[] {
  if (isAdminViewer) {
    if (status) return db.prepare('SELECT * FROM tournaments WHERE status = ? ORDER BY created_at DESC').all(status) as TournamentRow[];
    return db.prepare('SELECT * FROM tournaments ORDER BY created_at DESC').all() as TournamentRow[];
  }
  const params: unknown[] = [viewer.id, viewer.id];
  let query = `SELECT DISTINCT t.* FROM tournaments t
    LEFT JOIN tournament_players tp ON tp.tournament_id = t.id
    WHERE (t.created_by = ? OR tp.player_id = ?)`;
  if (status) { query += ' AND t.status = ?'; params.push(status); }
  query += ' ORDER BY t.created_at DESC';
  return db.prepare(query).all(...params) as TournamentRow[];
}

export function isTournamentParticipant(tournamentId: number, playerId: number): boolean {
  return !!db.prepare(
    'SELECT 1 FROM tournament_players WHERE tournament_id = ? AND player_id = ?'
  ).get(tournamentId, playerId);
}

export function isMatchParticipant(tournamentId: number, matchId: number, playerId: number): boolean {
  const m = db.prepare(
    'SELECT home_player_id, away_player_id FROM tournament_matches WHERE id = ? AND tournament_id = ?'
  ).get(matchId, tournamentId) as { home_player_id: number | null; away_player_id: number | null } | undefined;
  return !!m && (m.home_player_id === playerId || m.away_player_id === playerId);
}

/**
 * Launch the backing game for a `ready` match. Creates a normal games row +
 * game_players (+ cricket_state) exactly like POST /api/games, copying the
 * tournament's match settings. Returns the new gameId.
 */
export function launchMatch(tournamentId: number, matchId: number): number {
  const t = getTournamentRow(tournamentId);
  if (!t) throw Object.assign(new Error('Tournament not found'), { statusCode: 404 });
  const match = db.prepare(
    'SELECT * FROM tournament_matches WHERE id = ? AND tournament_id = ?'
  ).get(matchId, tournamentId) as TournamentMatchRow | undefined;
  if (!match) throw Object.assign(new Error('Match not found'), { statusCode: 404 });
  if (match.game_id) {
    // Already launched — return the existing game (idempotent resume).
    return match.game_id;
  }
  if (match.status !== 'ready' || match.home_player_id === null || match.away_player_id === null) {
    throw Object.assign(new Error('Match is not ready to play'), { statusCode: 409 });
  }

  // Online tournament matches launch as online games so Phase 8a's per-device
  // turn gate applies — each participant throws only on their own device. Both
  // seats are seeded here, so the game is "full" immediately (maxPlayers = 2).
  const gameSettings = JSON.parse(t.match_settings || '{}') as Record<string, unknown>;
  if (t.is_online) gameSettings.maxPlayers = 2;

  const launch = db.transaction(() => {
    const r = db.prepare('INSERT INTO games (mode, settings, is_online) VALUES (?, ?, ?)')
      .run(t.mode, JSON.stringify(gameSettings), t.is_online ? 1 : 0);
    const gameId = r.lastInsertRowid as number;
    const insertGp = db.prepare('INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)');
    insertGp.run(gameId, match.home_player_id, 0);
    insertGp.run(gameId, match.away_player_id, 1);
    if (t.mode === 'cricket') {
      const insertCs = db.prepare('INSERT INTO cricket_state (game_id, player_id) VALUES (?, ?)');
      insertCs.run(gameId, match.home_player_id);
      insertCs.run(gameId, match.away_player_id);
    }
    db.prepare("UPDATE tournament_matches SET game_id = ?, status = 'in_progress' WHERE id = ?").run(gameId, matchId);
    return gameId;
  });
  return launch();
}

/**
 * Called from the socket handler after a game's winner_id is set. If the game
 * backs a tournament match, settles the match (result read server-side from
 * game_players) and advances the bracket. No-ops (returns null) for ordinary games.
 */
export function settleCompletedGame(gameId: number): { tournamentId: number } | null {
  const match = db.prepare(
    "SELECT * FROM tournament_matches WHERE game_id = ? AND status = 'in_progress'"
  ).get(gameId) as TournamentMatchRow | undefined;
  if (!match) return null;

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as
    { winner_id: number | null; settings: string; status: string } | undefined;
  if (!game || game.status !== 'completed' || game.winner_id === null) return null;

  const t = getTournamentRow(match.tournament_id);
  if (!t) return null;

  const settings: MatchSettings = JSON.parse(game.settings || '{}');
  const gp = db.prepare(
    'SELECT player_id, legs_won, sets_won FROM game_players WHERE game_id = ?'
  ).all(gameId) as { player_id: number; legs_won: number; sets_won: number }[];
  const wonOf = (pid: number): number => {
    const row = gp.find((g) => g.player_id === pid);
    if (!row) return 0;
    if (settings.format === 'sets') return row.sets_won;
    if (settings.format === 'legs') return row.legs_won;
    return game.winner_id === pid ? 1 : 0; // single leg
  };

  const winnerId = game.winner_id;
  const loserId = match.home_player_id === winnerId ? match.away_player_id : match.home_player_id;

  db.transaction(() => {
    db.prepare(
      "UPDATE tournament_matches SET home_legs = ?, away_legs = ?, winner_id = ?, status = 'completed' WHERE id = ?"
    ).run(wonOf(match.home_player_id!), wonOf(match.away_player_id!), winnerId, match.id);

    if (loserId !== null) {
      db.prepare('UPDATE tournament_players SET eliminated = 1 WHERE tournament_id = ? AND player_id = ?')
        .run(match.tournament_id, loserId);
    }

    if (match.next_match_id !== null) {
      const col = match.next_slot === 'home' ? 'home_player_id' : 'away_player_id';
      db.prepare(`UPDATE tournament_matches SET ${col} = ? WHERE id = ?`).run(winnerId, match.next_match_id);
      const nxt = db.prepare('SELECT * FROM tournament_matches WHERE id = ?').get(match.next_match_id) as TournamentMatchRow;
      if (nxt.status === 'pending' && nxt.home_player_id !== null && nxt.away_player_id !== null) {
        db.prepare("UPDATE tournament_matches SET status = 'ready' WHERE id = ?").run(nxt.id);
      }
    } else {
      // Final settled → tournament champion.
      db.prepare("UPDATE tournaments SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(winnerId, match.tournament_id);
    }
  })();

  return { tournamentId: match.tournament_id };
}

export function deleteTournament(id: number): void {
  // Cascade-delete the scheduled-but-unplayed games this tournament created so
  // the lobby's Resume strip doesn't fill with phantom fixtures.
  db.transaction(() => {
    const gameIds = db.prepare(
      'SELECT game_id FROM tournament_matches WHERE tournament_id = ? AND game_id IS NOT NULL'
    ).all(id) as { game_id: number }[];
    const delGame = db.prepare('DELETE FROM games WHERE id = ?');
    for (const { game_id } of gameIds) delGame.run(game_id);
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(id);
  })();
}
