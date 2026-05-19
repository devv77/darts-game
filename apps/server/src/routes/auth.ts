import type { FastifyInstance } from 'fastify';
import {
  createSession,
  deleteSession,
  extractBearer,
  isAdmin,
  lookupSession,
  oauthClient,
  upsertGooglePlayer,
  verifyGoogleCredential,
} from '../auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async () => {
    return {
      googleClientId: process.env.GOOGLE_CLIENT_ID || null,
      enabled: !!oauthClient,
    };
  });

  app.post<{ Body: { credential?: string } }>('/api/auth/google', async (req, reply) => {
    const credential = req.body?.credential;
    if (!credential) {
      return reply.code(400).send({ error: 'credential required' });
    }
    try {
      const verified = await verifyGoogleCredential(credential);
      const player = upsertGooglePlayer(verified);
      const { token, expiresAt } = createSession(player.id);
      return { player, token, expiresAt, isAdmin: isAdmin(player) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      app.log.warn({ err: msg }, 'Google credential rejected');
      return reply.code(401).send({ error: msg });
    }
  });

  app.get('/api/auth/me', async (req, reply) => {
    const player = lookupSession(extractBearer(req.headers.authorization));
    if (!player) return reply.code(401).send({ error: 'Not authenticated' });
    return { player, isAdmin: isAdmin(player) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = extractBearer(req.headers.authorization);
    if (token) deleteSession(token);
    return reply.code(204).send();
  });
}
