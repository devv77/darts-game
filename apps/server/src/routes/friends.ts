import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { sanitizePlayer } from '../sanitize.js';
import { isPlayerOnline } from '../socket-handler.js';
import type { Player } from '../types.js';

interface FriendRow { player_id: number; friend_id: number; status: string }

export async function friendsRoutes(app: FastifyInstance) {
  // List accepted friends + incoming/outgoing pending invites, each with presence.
  app.get('/api/friends', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });

    const rows = db.prepare(
      'SELECT player_id, friend_id, status FROM friends WHERE player_id = ? OR friend_id = ?'
    ).all(me.id, me.id) as FriendRow[];

    const otherId = (r: FriendRow) => (r.player_id === me.id ? r.friend_id : r.player_id);
    const decorate = (pid: number) => {
      const p = db.prepare('SELECT * FROM players WHERE id = ?').get(pid) as Player | undefined;
      if (!p) return null;
      return { player: sanitizePlayer(p, me), online: isPlayerOnline(pid) };
    };

    const friends = rows.filter((r) => r.status === 'accepted').map((r) => decorate(otherId(r))).filter(Boolean);
    const incoming = rows.filter((r) => r.status === 'pending' && r.friend_id === me.id).map((r) => decorate(r.player_id)).filter(Boolean);
    const outgoing = rows.filter((r) => r.status === 'pending' && r.player_id === me.id).map((r) => decorate(r.friend_id)).filter(Boolean);
    return { friends, incoming, outgoing };
  });

  // Invite by email (contains '@') or exact name.
  app.post<{ Body: { query?: string } }>('/api/friends/invite', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });
    const q = (req.body?.query ?? '').trim();
    if (!q) return reply.code(400).send({ error: 'Provide a name or email' });

    const target = q.includes('@')
      ? db.prepare('SELECT * FROM players WHERE lower(email) = lower(?) AND is_ai = 0').get(q) as Player | undefined
      : db.prepare('SELECT * FROM players WHERE name = ? AND is_ai = 0').get(q) as Player | undefined;
    if (!target) return reply.code(404).send({ error: 'No player found for that name/email' });
    if (target.id === me.id) return reply.code(400).send({ error: "You can't add yourself" });

    const existing = db.prepare(
      'SELECT * FROM friends WHERE (player_id = ? AND friend_id = ?) OR (player_id = ? AND friend_id = ?)'
    ).get(me.id, target.id, target.id, me.id) as FriendRow | undefined;
    if (existing) {
      if (existing.status === 'accepted') return reply.code(409).send({ error: 'Already friends' });
      if (existing.status === 'blocked') return reply.code(403).send({ error: 'Cannot invite this player' });
      // They already invited me → accept it (mutual).
      if (existing.player_id === target.id) {
        db.prepare("UPDATE friends SET status = 'accepted' WHERE player_id = ? AND friend_id = ?").run(target.id, me.id);
        return { status: 'accepted' };
      }
      return reply.code(409).send({ error: 'Invite already pending' });
    }
    db.prepare("INSERT INTO friends (player_id, friend_id, status) VALUES (?, ?, 'pending')").run(me.id, target.id);
    return reply.code(201).send({ status: 'pending' });
  });

  app.post<{ Params: { id: string } }>('/api/friends/:id/accept', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });
    const fromId = parseInt(req.params.id, 10);
    if (!Number.isInteger(fromId)) return reply.code(400).send({ error: 'Invalid id' });
    const row = db.prepare(
      "SELECT * FROM friends WHERE player_id = ? AND friend_id = ? AND status = 'pending'"
    ).get(fromId, me.id) as FriendRow | undefined;
    if (!row) return reply.code(404).send({ error: 'No pending invite from that player' });
    db.prepare("UPDATE friends SET status = 'accepted' WHERE player_id = ? AND friend_id = ?").run(fromId, me.id);
    return { status: 'accepted' };
  });

  // Remove / decline a relationship in either direction.
  app.delete<{ Params: { id: string } }>('/api/friends/:id', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });
    const otherId = parseInt(req.params.id, 10);
    if (!Number.isInteger(otherId)) return reply.code(400).send({ error: 'Invalid id' });
    db.prepare(
      'DELETE FROM friends WHERE (player_id = ? AND friend_id = ?) OR (player_id = ? AND friend_id = ?)'
    ).run(me.id, otherId, otherId, me.id);
    return reply.code(204).send();
  });
}
