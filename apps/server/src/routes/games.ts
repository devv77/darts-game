import type { FastifyInstance, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import { getFullGameState } from '../game-state.js';
import { sanitizeGamePlayer } from '../sanitize.js';
import type { Game, GameMode, GamePlayer, Player } from '../types.js';

interface CreateGameBody {
  mode?: GameMode;
  player_ids?: number[];
  settings?: Record<string, unknown>;
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
    const { mode, player_ids, settings } = req.body || {};
    if (!mode || !['501', '301', 'cricket'].includes(mode)) {
      return reply.code(400).send({ error: 'Invalid mode' });
    }
    const minPlayers = mode === 'cricket' ? 1 : 2;
    if (!player_ids || !Array.isArray(player_ids) || player_ids.length < minPlayers) {
      return reply.code(400).send({ error: `At least ${minPlayers} player(s) required` });
    }
    if (new Set(player_ids).size !== player_ids.length) {
      return reply.code(400).send({ error: 'Duplicate player_ids' });
    }
    if (!player_ids.every((id) => Number.isInteger(id))) {
      return reply.code(400).send({ error: 'player_ids must be integers' });
    }
    const requester = req.player;
    if (!requester) return reply.code(401).send({ error: 'Authentication required' });
    if (!isAdmin(requester) && !player_ids.includes(requester.id)) {
      return reply.code(403).send({ error: 'You must be a participant in games you create' });
    }
    const existingRows = db.prepare(
      `SELECT id FROM players WHERE id IN (${player_ids.map(() => '?').join(',')})`
    ).all(...player_ids) as { id: number }[];
    if (existingRows.length !== player_ids.length) {
      const known = new Set(existingRows.map((r) => r.id));
      const missing = player_ids.filter((id) => !known.has(id));
      return reply.code(400).send({ error: `Unknown player ids: ${missing.join(', ')}` });
    }

    const createGame = db.transaction(() => {
      const result = db.prepare(
        'INSERT INTO games (mode, settings) VALUES (?, ?)'
      ).run(mode, JSON.stringify(settings || {}));
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
