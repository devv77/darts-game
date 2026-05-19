import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import { playerFromRequest } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { playersRoutes } from './routes/players.js';
import { gamesRoutes } from './routes/games.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  await app.register(fastifyCors, { origin: true });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/auth/')) return;
    const player = playerFromRequest(req);
    if (!player) {
      reply.code(401).send({ error: 'Authentication required' });
      return;
    }
    req.player = player;
  });

  await app.register(authRoutes);
  await app.register(playersRoutes);
  await app.register(gamesRoutes);
  await app.register(statsRoutes);
  await app.register(adminRoutes);

  return app;
}
