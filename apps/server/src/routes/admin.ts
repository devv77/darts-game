import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';

export async function adminRoutes(app: FastifyInstance) {
  app.delete('/api/admin/reset', async (req, reply) => {
    if (!isAdmin(req.player)) {
      return reply.code(403).send({ error: 'Admin access required' });
    }
    db.transaction(() => {
      db.exec('DELETE FROM sessions');
      db.exec('DELETE FROM cricket_state');
      db.exec('DELETE FROM turns');
      db.exec('DELETE FROM game_players');
      db.exec('DELETE FROM games');
      db.exec('DELETE FROM players WHERE is_ai = 0');
    })();
    return { message: 'All games and human players deleted' };
  });
}
