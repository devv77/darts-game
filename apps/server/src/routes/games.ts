import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getFullGameState } from '../game-state.js';
import type { Game, GameMode } from '../types.js';

interface CreateGameBody {
  mode?: GameMode;
  player_ids?: number[];
  settings?: Record<string, unknown>;
}

export async function gamesRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { status?: string } }>('/api/games', async (req) => {
    const { status } = req.query;
    let query = 'SELECT * FROM games';
    const params: unknown[] = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC';
    return db.prepare(query).all(...params) as Game[];
  });

  app.post<{ Body: CreateGameBody }>('/api/games', async (req, reply) => {
    const { mode, player_ids, settings } = req.body || {};
    if (!mode || !['501', '301', 'cricket'].includes(mode)) {
      return reply.code(400).send({ error: 'Invalid mode' });
    }
    const minPlayers = mode === 'cricket' ? 1 : 2;
    if (!player_ids || player_ids.length < minPlayers) {
      return reply.code(400).send({ error: `At least ${minPlayers} player(s) required` });
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
    const game = getFullGameState(gameId);
    return reply.code(201).send(game);
  });

  app.get<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    const game = getFullGameState(req.params.id);
    if (!game) return reply.code(404).send({ error: 'Game not found' });
    return game;
  });

  app.delete<{ Params: { id: string } }>('/api/games/:id', async (req, reply) => {
    db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
    return reply.code(204).send();
  });
}
