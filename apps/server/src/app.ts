import Fastify, { type FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyMultipart from '@fastify/multipart';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { playerFromRequest } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { playersRoutes } from './routes/players.js';
import { gamesRoutes } from './routes/games.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';
import { practiceRoutes } from './routes/practice.js';
import { tournamentsRoutes } from './routes/tournaments.js';
import { friendsRoutes } from './routes/friends.js';
import { pushRoutes } from './routes/push.js';

export interface BuildAppOptions {
  logger?: boolean | { level: string };
  rateLimit?: boolean | { max: number; timeWindow: string };
  helmet?: boolean;
  allowedOrigins?: string[];
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STARTED_AT = new Date().toISOString();

export async function buildApp(opts: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: opts.logger ?? false,
  });

  // Health/version — unauthenticated (for monitoring + the /health page).
  // Reports the backend version + whether the built web app is present to serve;
  // the frontend cross-checks its own baked hash against `version` to spot drift.
  app.get('/api/health', async () => {
    // Git short SHA baked at image build (Dockerfile ARG → env); 'dev' otherwise.
    const version = process.env.GIT_SHA || 'dev';
    const webIndex = path.resolve(__dirname, '..', '..', 'web', 'dist', 'index.html');
    const frontendServed = fs.existsSync(webIndex);
    return {
      status: 'ok',
      version,
      backend: { status: 'ok', version, uptimeSeconds: Math.round(process.uptime()) },
      frontend: { status: frontendServed ? 'served' : 'missing', version },
      startedAt: STARTED_AT,
      time: new Date().toISOString(),
    };
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

  // Rate limiting — keyed by the *validated* session player when present, else
  // by IP. Keying on the raw bearer string let an attacker rotate junk tokens
  // to get a fresh bucket per request (bypassing the limit); resolving the
  // session means unauthenticated/garbage tokens all collapse onto the IP
  // bucket. Skipped entirely when opts.rateLimit === false (test default) so
  // the existing route tests can hammer the API without 429ing themselves.
  const rl = opts.rateLimit ?? { max: 200, timeWindow: '1 minute' };
  if (rl !== false) {
    const config = rl === true ? { max: 200, timeWindow: '1 minute' } : rl;
    await app.register(fastifyRateLimit, {
      ...config,
      keyGenerator: (req) => {
        const player = playerFromRequest(req);
        return player ? `player:${player.id}` : `ip:${req.ip}`;
      },
    });
  }

  // Avatar uploads (max 5 MB, one file) for the profile-picture feature.
  await app.register(fastifyMultipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 4 } });

  app.addHook('preHandler', async (req, reply) => {
    const url = req.url.split('?')[0]!;
    if (!url.startsWith('/api/')) return;
    if (url.startsWith('/api/auth/')) return;
    if (url === '/api/health') return; // unauthenticated health/version probe
    // Serving an avatar image is public-ish and must work from an <img> tag,
    // which can't send the bearer token — exempt the GET from the auth gate.
    if (req.method === 'GET' && /^\/api\/players\/\d+\/avatar$/.test(url)) return;
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
  await app.register(tournamentsRoutes);
  await app.register(friendsRoutes);
  await app.register(pushRoutes);

  return app;
}
