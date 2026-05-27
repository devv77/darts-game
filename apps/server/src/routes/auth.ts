import type { FastifyInstance } from 'fastify';
import {
  createSession,
  deleteSession,
  extractBearer,
  googleClientId,
  isAdmin,
  localAuthEnabled,
  lookupSession,
  oauthClient,
  upsertGooglePlayer,
  upsertLocalPlayer,
  verifyGoogleCredential,
} from '../auth.js';

export async function authRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async () => {
    return {
      googleClientId,
      enabled: !!oauthClient,
      localAuth: localAuthEnabled,
    };
  });

  // Passwordless self-hosted sign-in — only reachable when Google is not
  // configured (returns 404 otherwise, so production is unaffected).
  app.post<{ Body: { name?: string } }>('/api/auth/local', async (req, reply) => {
    if (!localAuthEnabled) {
      return reply.code(404).send({ error: 'Not found' });
    }
    const player = upsertLocalPlayer(req.body?.name || 'Player');
    const { token, expiresAt } = createSession(player.id);
    return { player, token, expiresAt, isAdmin: isAdmin(player) };
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
