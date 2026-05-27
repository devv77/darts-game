import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { playerFromRequest } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { playersRoutes } from './routes/players.js';
import { gamesRoutes } from './routes/games.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';
import { practiceRoutes } from './routes/practice.js';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  rateLimit?: boolean | { max: number; timeWindow: string };
  helmet?: boolean;
  allowedOrigins?: string[];
}

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  if (opts.helmet !== false) {
    await app.register(fastifyHelmet, {
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Google Identity Services + Workbox-injected service-worker bootstrap.
          scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com', 'https://accounts.google.com'],
          connectSrc: ["'self'", 'https://accounts.google.com'],
          frameSrc: ['https://accounts.google.com'],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false, // GSI iframe doesn't set COEP
      crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' }, // GSI popup
    });
  }

  // Allowed origins: env-driven list, defaulting to localhost. `true` (reflect-any)
  // is the test default so .inject() with no Origin header still passes.
  const allowed = opts.allowedOrigins
    ?? (process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean) : null);
  await app.register(fastifyCors, {
    origin: allowed
      ? (origin, cb) => cb(null, !origin || allowed.includes(origin))
      : true,
  });

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
  await app.register(practiceRoutes);

  return app;
}
