import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { db, DATA_DIR } from '../db.js';
import { isAdmin } from '../auth.js';
import { sanitizePlayer } from '../sanitize.js';
import type { Player } from '../types.js';

const MAX_NAME_LENGTH = 50;

const AVATAR_DIR = path.join(DATA_DIR, 'avatars');
fs.mkdirSync(AVATAR_DIR, { recursive: true });
// Uploaded profile pictures: accepted types → stored extension.
const AVATAR_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};
const EXT_CONTENT_TYPE: Record<string, string> = {
  jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

function avatarFileFor(id: number): string | null {
  for (const ext of Object.keys(EXT_CONTENT_TYPE)) {
    const f = path.join(AVATAR_DIR, `${id}.${ext}`);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

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

    try {
      db.prepare('DELETE FROM players WHERE id = ?').run(id);
    } catch (err) {
      // turns / game_players / cricket_state / games.winner_id reference players
      // without ON DELETE cascade, so a player with completed-game history trips
      // a foreign-key constraint. Surface that as a clean 409 instead of a 500.
      const msg = err instanceof Error ? err.message : String(err);
      if (/FOREIGN KEY/i.test(msg)) {
        return reply.code(409).send({ error: 'Player has game history and cannot be deleted' });
      }
      throw err;
    }
    return reply.code(204).send();
  });

  // Upload a profile picture (self or admin). Stored on the data volume; the
  // player's avatar_url points back at the GET route below (cache-busted).
  app.post<{ Params: { id: string } }>('/api/players/:id/avatar', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined;
    if (!player) return reply.code(404).send({ error: 'Player not found' });
    if (!canEdit(req, player)) return reply.code(403).send({ error: 'Cannot modify this player' });

    let data;
    try {
      data = await req.file();
    } catch {
      return reply.code(400).send({ error: 'Expected a multipart file upload' });
    }
    if (!data) return reply.code(400).send({ error: 'No file uploaded' });
    const ext = AVATAR_TYPES[data.mimetype];
    if (!ext) return reply.code(400).send({ error: 'Unsupported image type (use JPEG, PNG, or WebP)' });

    // One file per player — clear any prior extension before writing the new one.
    for (const e of Object.keys(EXT_CONTENT_TYPE)) {
      const old = path.join(AVATAR_DIR, `${id}.${e}`);
      if (fs.existsSync(old)) fs.rmSync(old, { force: true });
    }
    const dest = path.join(AVATAR_DIR, `${id}.${ext}`);
    try {
      await pipeline(data.file, fs.createWriteStream(dest));
    } catch {
      fs.rmSync(dest, { force: true });
      return reply.code(500).send({ error: 'Failed to store image' });
    }
    // @fastify/multipart flags truncation when the 5 MB limit is exceeded.
    if (data.file.truncated) {
      fs.rmSync(dest, { force: true });
      return reply.code(413).send({ error: 'Image too large (max 5 MB)' });
    }

    const url = `/api/players/${id}/avatar?v=${Date.now()}`;
    db.prepare('UPDATE players SET avatar_url = ? WHERE id = ?').run(url, id);
    const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
    return sanitizePlayer(updated, req.player);
  });

  // Serve the stored avatar. Auth-exempt (see app.ts) so <img> tags can load it.
  app.get<{ Params: { id: string } }>('/api/players/:id/avatar', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });
    const file = avatarFileFor(id);
    if (!file) return reply.code(404).send({ error: 'No avatar' });
    const ext = file.split('.').pop()!;
    reply.header('Content-Type', EXT_CONTENT_TYPE[ext] || 'application/octet-stream');
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.send(fs.createReadStream(file));
  });

  // Grant / revoke the DB-backed admin flag (admin only).
  app.post<{ Params: { id: string }; Body: { isAdmin?: boolean } }>('/api/players/:id/admin', async (req, reply) => {
    if (!isAdmin(req.player)) return reply.code(403).send({ error: 'Admin access required' });
    const id = parseInt(req.params.id, 10);
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player | undefined;
    if (!player) return reply.code(404).send({ error: 'Player not found' });
    if (player.is_ai) return reply.code(400).send({ error: 'AI players cannot be admins' });
    const grant = req.body?.isAdmin === true;
    db.prepare('UPDATE players SET is_admin = ? WHERE id = ?').run(grant ? 1 : 0, id);
    const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
    return sanitizePlayer(updated, req.player);
  });
}
