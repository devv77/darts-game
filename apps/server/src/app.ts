import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import { playerFromRequest } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { playersRoutes } from './routes/players.js';
import { gamesRoutes } from './routes/games.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  rateLimit?: boolean | { max: number; timeWindow: string };
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  await app.register(fastifyCors, { origin: true });

  // Rate limiting — keyed by session token when present (falls back to IP).
  // Skipped entirely when opts.rateLimit === false (test default) so the
  // existing route tests can hammer the API without 429ing themselves.
  const rl = opts.rateLimit ?? { max: 200, timeWindow: '1 minute' };
  if (rl !== false) {
    const config = rl === true ? { max: 200, timeWindow: '1 minute' } : rl;
    await app.register(fastifyRateLimit, {
      ...config,
      keyGenerator: (req) => {
        const auth = req.headers.authorization;
        if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice(7);
        return req.ip;
      },
    });
  }

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
