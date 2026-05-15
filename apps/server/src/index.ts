import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCors from '@fastify/cors';
import { Server as SocketIOServer } from 'socket.io';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import './db.js';
import { playersRoutes } from './routes/players.js';
import { gamesRoutes } from './routes/games.js';
import { statsRoutes } from './routes/stats.js';
import { adminRoutes } from './routes/admin.js';
import { setupSocket } from './socket-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

const app = Fastify({
  logger: { level: isProd ? 'info' : 'debug' },
});

await app.register(fastifyCors, {
  origin: isProd ? false : true,
});

await app.register(playersRoutes);
await app.register(gamesRoutes);
await app.register(statsRoutes);
await app.register(adminRoutes);

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
