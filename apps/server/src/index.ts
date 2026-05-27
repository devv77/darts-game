import fastifyStatic from '@fastify/static';
import { Server as SocketIOServer } from 'socket.io';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import { googleClientId, pruneExpiredSessions } from './auth.js';
import { setupSocket } from './socket-handler.js';
import { buildApp } from './app.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

const app = await buildApp({
  logger: { level: isProd ? 'info' : 'debug' },
  rateLimit: { max: 200, timeWindow: '1 minute' },
  helmet: true,
});

pruneExpiredSessions();
if (!googleClientId) {
  app.log.warn('No Google client id (GOOGLE_CLIENT_ID / TEST_GOOGLE_CLIENT_ID) set — Google sign-in disabled; passwordless local sign-in is available instead');
}

// In production, serve the built React app
const webDist = path.resolve(__dirname, '..', '..', 'web', 'dist');
if (fs.existsSync(webDist)) {
  await app.register(fastifyStatic, {
    root: webDist,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback for client routes
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api') || req.url.startsWith('/socket.io')) {
      return reply.code(404).send({ error: 'Not Found' });
    }
    return reply.sendFile('index.html');
  });
}

await app.ready();

const io = new SocketIOServer(app.server, {
  cors: { origin: isProd ? false : '*' },
});
setupSocket(io);

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Darts Counter listening on http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
