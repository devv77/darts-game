import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import type { Player } from '../types.js';

function canMutate(req: FastifyRequest, targetId: number): boolean {
  if (isAdmin(req.player)) return true;
  return req.player?.id === targetId;
}

export async function playersRoutes(app: FastifyInstance) {
  app.get('/api/players', async () => {
    return db.prepare('SELECT * FROM players ORDER BY name').all() as Player[];
  });

  app.post<{ Body: { name?: string; avatar_color?: string; is_ai?: boolean; ai_level?: number } }>(
    '/api/players',
    async (req, reply) => {
      if (!isAdmin(req.player)) {
        return reply.code(403).send({ error: 'Admin access required' });
      }
      const { name, avatar_color, is_ai, ai_level } = req.body || {};
      if (!name || !name.trim()) {
        return reply.code(400).send({ error: 'Name is required' });
      }
      if (is_ai && (!ai_level || ai_level < 1 || ai_level > 10)) {
        return reply.code(400).send({ error: 'AI level must be 1-10' });
      }
      try {
        const result = db.prepare(
          'INSERT INTO players (name, avatar_color, is_ai, ai_level) VALUES (?, ?, ?, ?)'
        ).run(
          name.trim(),
          avatar_color || '#3b82f6',
          is_ai ? 1 : 0,
          is_ai ? ai_level! : null
        );
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid) as Player;
        return reply.code(201).send(player);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE')) {
          return reply.code(409).send({ error: 'Player name already exists' });
        }
        throw err;
      }
    }
  );

  app.put<{ Params: { id: string }; Body: { name?: string; avatar_color?: string } }>(
    '/api/players/:id',
    async (req: FastifyRequest<{ Params: { id: string }; Body: { name?: string; avatar_color?: string } }>, reply: FastifyReply) => {
      const id = parseInt(req.params.id, 10);
      if (!canMutate(req, id)) {
        return reply.code(403).send({ error: 'Cannot modify this player' });
      }
      const { name, avatar_color } = req.body || {};
      const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined;
      if (!player) return reply.code(404).send({ error: 'Player not found' });

      try {
        db.prepare('UPDATE players SET name = ?, avatar_color = ? WHERE id = ?').run(
          name || player.name,
          avatar_color || player.avatar_color,
          id
        );
        const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
        return updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('UNIQUE')) {
          return reply.code(409).send({ error: 'Player name already exists' });
        }
        throw err;
      }
    }
  );

  app.delete<{ Params: { id: string } }>('/api/players/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!canMutate(req, id)) {
      return reply.code(403).send({ error: 'Cannot delete this player' });
    }
    const active = db.prepare(
      `SELECT COUNT(*) as count FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.player_id = ? AND g.status = 'in_progress'`
    ).get(id) as { count: number };

    if (active.count > 0) {
      return reply.code(409).send({ error: 'Player has active games' });
    }

    db.prepare('DELETE FROM players WHERE id = ?').run(id);
    return reply.code(204).send();
  });
}
