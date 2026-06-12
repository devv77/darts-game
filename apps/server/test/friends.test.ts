import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

interface FriendsView {
  friends: { player: { id: number }; online: boolean }[];
  incoming: { player: { id: number } }[];
  outgoing: { player: { id: number } }[];
}

describe('Phase 8b — friends', () => {
  beforeEach(() => resetDb());

  it('requires auth (401)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/friends' });
    expect(res.statusCode).toBe(401);
  });

  it('invite by name creates a pending request shown to both sides', async () => {
    const a = createHumanWithSession('Alice');
    createHumanWithSession('Bob');
    const inv = await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });
    expect(inv.statusCode).toBe(201);

    const aView = (await app.inject({ method: 'GET', url: '/api/friends', headers: bearer(a.token) })).json() as FriendsView;
    expect(aView.outgoing).toHaveLength(1);
    expect(aView.friends).toHaveLength(0);
  });

  it('accept turns a pending invite into a mutual friendship', async () => {
    const a = createHumanWithSession('Alice');
    const b = createHumanWithSession('Bob');
    await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });

    const bView = (await app.inject({ method: 'GET', url: '/api/friends', headers: bearer(b.token) })).json() as FriendsView;
    expect(bView.incoming).toHaveLength(1);
    expect(bView.incoming[0]!.player.id).toBe(a.player.id);

    const acc = await app.inject({ method: 'POST', url: `/api/friends/${a.player.id}/accept`, headers: bearer(b.token) });
    expect(acc.statusCode).toBe(200);

    for (const who of [a, b]) {
      const v = (await app.inject({ method: 'GET', url: '/api/friends', headers: bearer(who.token) })).json() as FriendsView;
      expect(v.friends).toHaveLength(1);
      expect(v.incoming).toHaveLength(0);
      expect(v.outgoing).toHaveLength(0);
    }
  });

  it('a reverse invite auto-accepts (both invited each other)', async () => {
    const a = createHumanWithSession('Alice');
    const b = createHumanWithSession('Bob');
    await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });
    const res = await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(b.token), payload: { query: 'Alice' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { status: string }).status).toBe('accepted');
  });

  it('cannot invite yourself (400) or an unknown player (404)', async () => {
    const a = createHumanWithSession('Alice');
    expect((await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Alice' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Nobody' } })).statusCode).toBe(404);
  });

  it('duplicate invite is rejected (409)', async () => {
    const a = createHumanWithSession('Alice');
    createHumanWithSession('Bob');
    await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });
    const dup = await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });
    expect(dup.statusCode).toBe(409);
  });

  it('delete removes the friendship for both sides', async () => {
    const a = createHumanWithSession('Alice');
    const b = createHumanWithSession('Bob');
    await app.inject({ method: 'POST', url: '/api/friends/invite', headers: bearer(a.token), payload: { query: 'Bob' } });
    await app.inject({ method: 'POST', url: `/api/friends/${a.player.id}/accept`, headers: bearer(b.token) });
    const del = await app.inject({ method: 'DELETE', url: `/api/friends/${b.player.id}`, headers: bearer(a.token) });
    expect(del.statusCode).toBe(204);
    const v = (await app.inject({ method: 'GET', url: '/api/friends', headers: bearer(b.token) })).json() as FriendsView;
    expect(v.friends).toHaveLength(0);
  });
});
