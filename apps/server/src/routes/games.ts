import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import { getFullGameState } from '../game-state.js';
import { broadcastGameState } from '../socket-handler.js';
import { sanitizeGamePlayer } from '../sanitize.js';
import type { Game, GameMode, GamePlayer, Player } from '../types.js';

interface CreateGameBody {
  mode?: GameMode;
  player_ids?: number[];
  settings?: Record<string, unknown>;
  is_online?: boolean;
}

// Crockford-ish alphabet: no 0/O/1/I/L so codes are easy to read aloud / type.
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVITE_LEN = 5;

function generateInviteCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    let code = '';
    for (let i = 0; i < INVITE_LEN; i++) {
      code += INVITE_ALPHABET[Math.floor(Math.random() * INVITE_ALPHABET.length)];
    }
    const taken = db.prepare('SELECT 1 FROM games WHERE invite_code = ?').get(code);
    if (!taken) return code;
  }
  throw new Error('Could not allocate a unique invite code');
}

function isParticipant(gameId: number | string, playerId: number): boolean {
  const row = db.prepare(
    'SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?'
  ).get(gameId, playerId);
  return !!row;
}

export async function gamesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/api/games', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const { status } = req.query;
    if (isAdmin(viewer)) {
      let query = 'SELECT * FROM games';
      const params: unknown[] = [];
      if (status) {
        query += ' WHERE status = ?';
        params.push(status);
      }
      query += ' ORDER BY created_at DESC';
      return db.prepare(query).all(...params) as Game[];
    }
    let query = `SELECT DISTINCT g.* FROM games g
      JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.player_id = ?`;
    const params: unknown[] = [viewer.id];
    if (status) {
      query += ' AND g.status = ?';
      params.push(status);
    }
    query += ' ORDER BY g.created_at DESC';
    return db.prepare(query).all(...params) as Game[];
  });

  app.post<{ Body: CreateGameBody }>('/api/games', async (req, reply) => {
    const { mode, player_ids, settings, is_online } = req.body || {};
    if (!mode || !['501', '301', 'cricket'].includes(mode)) {
      return reply.code(400).send({ error: 'Invalid mode' });
    }
    const isOnline = is_online === true;
    // Online games fill the remaining seats via invite code, so the host can
    // create with just themselves; capacity comes from settings.maxPlayers.
    const maxPlayers = isOnline
      ? Math.max(2, Math.min(4, Number((settings as { maxPlayers?: unknown })?.maxPlayers) || 2))
      : undefined;
    const minPlayers = isOnline ? 1 : (mode === 'cricket' ? 1 : 2);
    if (!player_ids || !Array.isArray(player_ids) || player_ids.length < minPlayers) {
      return reply.code(400).send({ error: `At least ${minPlayers} player(s) required` });
    }
    if (new Set(player_ids).size !== player_ids.length) {
      return reply.code(400).send({ error: 'Duplicate player_ids' });
    }
    if (!player_ids.every((id) => Number.isInteger(id))) {
      return reply.code(400).send({ error: 'player_ids must be integers' });
    }
    if (isOnline && player_ids.length > maxPlayers!) {
      return reply.code(400).send({ error: `Too many players for a ${maxPlayers}-player online game` });
    }
    const requester = req.player;
    if (!requester) return reply.code(401).send({ error: 'Authentication required' });
    if (!isAdmin(requester) && !player_ids.includes(requester.id)) {
      return reply.code(403).send({ error: 'You must be a participant in games you create' });
    }
    const existingRows = db.prepare(
      `SELECT id, is_ai FROM players WHERE id IN (${player_ids.map(() => '?').join(',')})`
    ).all(...player_ids) as { id: number; is_ai: number }[];
    if (existingRows.length !== player_ids.length) {
      const known = new Set(existingRows.map((r) => r.id));
      const missing = player_ids.filter((id) => !known.has(id));
      return reply.code(400).send({ error: `Unknown player ids: ${missing.join(', ')}` });
    }
    // AI auto-turns are device-agnostic, so mixing them with remote humans is
    // deferred (see PLAN.md Phase 8 gotchas) — reject AI in online games for now.
    if (isOnline && existingRows.some((r) => r.is_ai)) {
      return reply.code(400).send({ error: 'AI players are not supported in online games yet' });
    }

    const persistedSettings = { ...(settings || {}) } as Record<string, unknown>;
    if (isOnline) persistedSettings.maxPlayers = maxPlayers;

    const createGame = db.transaction(() => {
      const inviteCode = isOnline ? generateInviteCode() : null;
      const result = db.prepare(
        'INSERT INTO games (mode, settings, is_online, invite_code) VALUES (?, ?, ?, ?)'
      ).run(mode, JSON.stringify(persistedSettings), isOnline ? 1 : 0, inviteCode);
      const gameId = result.lastInsertRowid as number;

      const insertPlayer = db.prepare(
        'INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)'
      );
      player_ids.forEach((pid, i) => insertPlayer.run(gameId, pid, i));

      if (mode === 'cricket') {
        const insertCricket = db.prepare(
          'INSERT INTO cricket_state (game_id, player_id) VALUES (?, ?)'
        );
        player_ids.forEach((pid) => insertCricket.run(gameId, pid));
      }
      return gameId;
    });

    const gameId = createGame();
    const game = getFullGameState(gameId)!;
    return reply.code(201).send(scrubGameForViewer(game, requester));
  });

  app.post<{ Body: { code?: string } }>('/api/games/join', async (req, reply) => {
    const requester = req.player;
    if (!requester) return reply.code(401).send({ error: 'Authentication required' });
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) return reply.code(400).send({ error: 'Invite code required' });

    const row = db.prepare('SELECT * FROM games WHERE invite_code = ?').get(code) as Game | undefined;
    // Treat unknown code and non-online game the same so codes can't be probed.
    if (!row || !row.is_online) return reply.code(404).send({ error: 'No open game found for that code' });
    if (row.status !== 'in_progress') {
      return reply.code(409).send({ error: 'That game is no longer joinable' });
    }

    const state = getFullGameState(row.id)!;
    // Idempotent: re-joining a game you're already in just returns it.
    if (state.players.some((p) => p.id === requester.id)) {
      return scrubGameForViewer(state, requester);
    }
    if (state.turns.length > 0) {
      return reply.code(409).send({ error: 'That game has already started' });
    }
    const maxPlayers = state.parsed_settings.maxPlayers ?? 2;
    if (state.players.length >= maxPlayers) {
      return reply.code(409).send({ error: 'That game is full' });
    }

    db.transaction(() => {
      const position = state.players.length;
      db.prepare(
        'INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)'
      ).run(row.id, requester.id, position);
      if (row.mode === 'cricket') {
        db.prepare('INSERT INTO cricket_state (game_id, player_id) VALUES (?, ?)').run(row.id, requester.id);
      }
    })();

    // Push the new roster (and, once full, the now-playable state) to everyone
    // already in the room so the host sees the opponent arrive in real time.
    broadcastGameState(row.id);

    const joined = getFullGameState(row.id)!;
    return scrubGameForViewer(joined, requester);
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const game = getFullGameState(req.params.id);
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    if (!isAdmin(viewer) && !game.players.some((p) => p.id === viewer.id)) {
      return reply.code(403).send({ error: 'Not a participant in this game' });
    }
    return scrubGameForViewer(game, viewer);
  });

  app.delete<{ Params: { id: string } }>('/api/games/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid game id' });
    const exists = db.prepare('SELECT 1 FROM games WHERE id = ?').get(id);
    if (!exists) return reply.code(404).send({ error: 'Game not found' });
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    if (!isAdmin(viewer) && !isParticipant(id, viewer.id)) {
      return reply.code(403).send({ error: 'Not a participant in this game' });
    }
    db.prepare('DELETE FROM games WHERE id = ?').run(id);
    return reply.code(204).send();
  });
}

function scrubGameForViewer<T extends { players: GamePlayer[] }>(
  game: T,
  viewer: Player | undefined
): T {
  return {
    ...game,
    players: game.players.map((p) => sanitizeGamePlayer(p, viewer)),
  };
}
