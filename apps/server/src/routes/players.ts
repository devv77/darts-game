import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import { sanitizePlayer } from '../sanitize.js';
import type { Player } from '../types.js';

const MAX_NAME_LENGTH = 50;

function canEdit(req: FastifyRequest, target: Player): boolean {
  if (isAdmin(req.player)) return true;
  return req.player?.id === target.id;
}

function canDeletePlayer(req: FastifyRequest, target: Player): boolean {
  if (isAdmin(req.player)) return true;
  return req.player?.id === target.id;
}

export async function playersRoutes(app: FastifyInstance) {
  app.get('/api/players', async (req) => {
    const all = db.prepare('SELECT * FROM players ORDER BY name').all() as Player[];
    return all.map((p) => sanitizePlayer(p, req.player));
  });

  app.post<{ Body: { name?: string; avatar_color?: string; is_ai?: boolean; ai_level?: number } }>(
    '/api/players',
    async (req, reply) => {
      const { name, avatar_color, is_ai, ai_level } = req.body || {};
      if (is_ai && !isAdmin(req.player)) {
        return reply.code(403).send({ error: 'Admin access required to create AI players' });
      }
      if (!name || !name.trim()) {
        return reply.code(400).send({ error: 'Name is required' });
      }
      const trimmedName = name.trim();
      if (trimmedName.length > MAX_NAME_LENGTH) {
        return reply.code(400).send({ error: `Name must be ${MAX_NAME_LENGTH} characters or fewer` });
      }
      if (is_ai && (!ai_level || ai_level < 1 || ai_level > 10)) {
        return reply.code(400).send({ error: 'AI level must be 1-10' });
      }
      try {
        const result = db.prepare(
          'INSERT INTO players (name, avatar_color, is_ai, ai_level) VALUES (?, ?, ?, ?)'
        ).run(
          trimmedName,
          avatar_color || '#3b82f6',
          is_ai ? 1 : 0,
          is_ai ? ai_level! : null
        );
        const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid) as Player;
        return reply.code(201).send(sanitizePlayer(player, req.player));
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
      const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined;
      if (!player) return reply.code(404).send({ error: 'Player not found' });
      if (!canEdit(req, player)) {
        return reply.code(403).send({ error: 'Cannot modify this player' });
      }
      const { name, avatar_color } = req.body || {};
      if (name !== undefined && (typeof name !== 'string' || name.trim().length === 0 || name.trim().length > MAX_NAME_LENGTH)) {
        return reply.code(400).send({ error: `Name must be 1-${MAX_NAME_LENGTH} characters` });
      }

      try {
        db.prepare('UPDATE players SET name = ?, avatar_color = ? WHERE id = ?').run(
          name ? name.trim() : player.name,
          avatar_color || player.avatar_color,
          id
        );
        const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
        return sanitizePlayer(updated, req.player);
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
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined;
    if (!player) return reply.code(404).send({ error: 'Player not found' });
    if (!canDeletePlayer(req, player)) {
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
