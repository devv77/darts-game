import type { FastifyInstance } from 'fastify';
import { getVapidPublicKey, pushEnabled, saveSubscription, removeSubscription, type PushSubscriptionInput } from '../push.js';

export async function pushRoutes(app: FastifyInstance) {
  app.get('/api/push/vapid', async () => ({ publicKey: getVapidPublicKey(), enabled: pushEnabled }));

  app.post<{ Body: { subscription?: PushSubscriptionInput } }>('/api/push/subscribe', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });
    if (!pushEnabled) return reply.code(503).send({ error: 'Push not configured' });
    try {
      saveSubscription(me.id, req.body!.subscription!);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return reply.code(201).send({ ok: true });
  });

  app.post<{ Body: { endpoint?: string } }>('/api/push/unsubscribe', async (req, reply) => {
    const me = req.player;
    if (!me) return reply.code(401).send({ error: 'Authentication required' });
    const endpoint = req.body?.endpoint;
    if (endpoint) removeSubscription(me.id, endpoint);
    return reply.code(204).send();
  });
}
