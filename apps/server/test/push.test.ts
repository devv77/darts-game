import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

describe('Phase 8c — push routes (no VAPID configured in tests)', () => {
  beforeEach(() => resetDb());

  it('requires auth on /api/push/vapid (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/push/vapid' });
    expect(res.statusCode).toBe(401);
  });

  it('reports push disabled when no VAPID keys are set', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/push/vapid', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { enabled: boolean; publicKey: string | null };
    expect(body.enabled).toBe(false);
    expect(body.publicKey).toBeNull();
  });

  it('subscribe returns 503 while push is unconfigured', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/push/subscribe', headers: bearer(token),
      payload: { subscription: { endpoint: 'https://x', keys: { p256dh: 'a', auth: 'b' } } },
    });
    expect(res.statusCode).toBe(503);
  });

  it('unsubscribe is a no-op 204 (idempotent)', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/push/unsubscribe', headers: bearer(token), payload: { endpoint: 'https://x' },
    });
    expect(res.statusCode).toBe(204);
  });
});
