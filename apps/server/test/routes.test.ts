import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';
import type { Player } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false });
});

describe('global auth gate', () => {
  beforeEach(() => resetDb());

  it('rejects /api/* with no Authorization header (401)', async () => {
    for (const url of ['/api/players', '/api/games', '/api/stats/players/1', '/api/admin/reset']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  it('rejects /api/* with an invalid bearer token (401)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/players',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows /api/auth/config without authentication', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('enabled');
  });

  it('lets static routes through without auth (no /api/ prefix)', async () => {
    // No static dir in test mode → 404, not 401.
    const res = await app.inject({ method: 'GET', url: '/some-static-asset' });
    expect(res.statusCode).toBe(404);
  });
});

describe('/api/players — CRUD with auth', () => {
  beforeEach(() => resetDb());

  it('GET lists all players (auth required)', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/players', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Player[];
    expect(Array.isArray(body)).toBe(true);
    // 10 AI players seeded at startup + Alice.
    expect(body.filter((p) => !p.is_ai).length).toBeGreaterThanOrEqual(1);
  });

  it('POST allows a signed-in non-admin to create a local guest player', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers: bearer(token),
      payload: { name: 'Bob', avatar_color: '#ff0000' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as Player;
    expect(body.name).toBe('Bob');
    expect(body.is_ai).toBe(0);
    expect(body.google_id).toBeNull();
  });

  it('POST rejects empty name (400)', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers: bearer(token),
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST rejects duplicate name (409)', async () => {
    const { token } = createHumanWithSession('Alice');
    await app.inject({ method: 'POST', url: '/api/players', headers: bearer(token), payload: { name: 'Bob' } });
    const res = await app.inject({ method: 'POST', url: '/api/players', headers: bearer(token), payload: { name: 'Bob' } });
    expect(res.statusCode).toBe(409);
  });

  it('POST AI player requires admin', async () => {
    const { token } = createHumanWithSession('Regular');
    const res = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers: bearer(token),
      payload: { name: 'Custom AI', is_ai: true, ai_level: 5 },
    });
    expect(res.statusCode).toBe(403);
  });

  it('POST AI player succeeds with admin email', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const { token } = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/players',
      headers: bearer(token),
      payload: { name: 'Custom AI', is_ai: true, ai_level: 5 },
    });
    expect(res.statusCode).toBe(201);
    process.env.ADMIN_EMAILS = '';
  });

  it('PUT rename — self can rename themselves', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/players/${player.id}`,
      headers: bearer(token),
      payload: { name: 'Alice the Great' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Player;
    expect(body.name).toBe('Alice the Great');
  });

  it('PUT rename — non-admin cannot rename someone else (403)', async () => {
    const { token: aliceToken } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const res = await app.inject({
      method: 'PUT',
      url: `/api/players/${bob.player.id}`,
      headers: bearer(aliceToken),
      payload: { name: 'Hacked' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('PUT 404 for unknown player id', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'PUT',
      url: '/api/players/99999',
      headers: bearer(token),
      payload: { name: 'Ghost' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE — anyone can delete a local guest', async () => {
    const { token } = createHumanWithSession('Alice');
    const post = await app.inject({
      method: 'POST', url: '/api/players', headers: bearer(token), payload: { name: 'Guest' },
    });
    const guestId = (post.json() as Player).id;

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/players/${guestId}`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(204);
  });

  it('DELETE — non-admin cannot delete another Google-linked player (403)', async () => {
    const { token: aliceToken } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob', { googleId: 'g_bob', email: 'bob@x.com' });
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/players/${bob.player.id}`,
      headers: bearer(aliceToken),
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE — can delete self', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/players/${player.id}`,
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(204);
  });
});

describe('/api/games — create + read + delete', () => {
  beforeEach(() => resetDb());

  it('POST 400 when fewer than 2 players for 501', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST 400 for invalid mode', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '701', player_ids: [player.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('POST 201 for a valid 501 game; GET retrieves it', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, bob.player.id], settings: { format: 'single' } },
    });
    expect(create.statusCode).toBe(201);
    const game = create.json() as { id: number; status: string; mode: string; players: { id: number }[] };
    expect(game.mode).toBe('501');
    expect(game.players).toHaveLength(2);
    expect(game.status).toBe('in_progress');

    const get = await app.inject({ method: 'GET', url: `/api/games/${game.id}`, headers: bearer(token) });
    expect(get.statusCode).toBe(200);
  });

  it('POST 201 for cricket allows single player', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: 'cricket', player_ids: [player.id], settings: {} },
    });
    expect(res.statusCode).toBe(201);
  });

  it('GET /api/games returns array; filter by status works', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, bob.player.id] },
    });
    const all = await app.inject({ method: 'GET', url: '/api/games', headers: bearer(token) });
    const inProgress = await app.inject({ method: 'GET', url: '/api/games?status=in_progress', headers: bearer(token) });
    expect((all.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((inProgress.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  it('GET 404 for unknown game id', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/games/99999', headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE 204 removes a game', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };
    const del = await app.inject({ method: 'DELETE', url: `/api/games/${id}`, headers: bearer(token) });
    expect(del.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: `/api/games/${id}`, headers: bearer(token) });
    expect(after.statusCode).toBe(404);
  });
});

describe('/api/stats', () => {
  beforeEach(() => resetDb());

  it('GET /api/stats/players/:id returns zeros for a player with no games', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: `/api/stats/players/${player.id}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { games_played: number; games_won: number };
    expect(body.games_played).toBe(0);
    expect(body.games_won).toBe(0);
  });

  it('GET /api/stats/players/:id 404 for unknown player', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/stats/players/99999', headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/stats/games/:id 404 for unknown game', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/stats/games/99999', headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/stats/games/:id returns per-player + per-leg breakdown', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };
    const res = await app.inject({ method: 'GET', url: `/api/stats/games/${id}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { player_stats: unknown[]; leg_stats: unknown[] };
    expect(body.player_stats).toHaveLength(2);
    expect(Array.isArray(body.leg_stats)).toBe(true);
  });
});

describe('/api/admin/reset', () => {
  beforeEach(() => resetDb());

  it('DELETE 403 for a non-admin session', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'DELETE', url: '/api/admin/reset', headers: bearer(token) });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE 200 for an admin session, wipes humans + games but keeps AI', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const { token } = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });

    // Seed: a guest player and a game.
    await app.inject({ method: 'POST', url: '/api/players', headers: bearer(token), payload: { name: 'Guest' } });
    const beforeAi = (db.prepare('SELECT COUNT(*) c FROM players WHERE is_ai = 1').get() as { c: number }).c;
    const beforeHumans = (db.prepare('SELECT COUNT(*) c FROM players WHERE is_ai = 0').get() as { c: number }).c;
    expect(beforeHumans).toBeGreaterThan(0);

    const res = await app.inject({ method: 'DELETE', url: '/api/admin/reset', headers: bearer(token) });
    expect(res.statusCode).toBe(200);

    const afterAi = (db.prepare('SELECT COUNT(*) c FROM players WHERE is_ai = 1').get() as { c: number }).c;
    const afterHumans = (db.prepare('SELECT COUNT(*) c FROM players WHERE is_ai = 0').get() as { c: number }).c;
    expect(afterAi).toBe(beforeAi);
    expect(afterHumans).toBe(0);

    process.env.ADMIN_EMAILS = '';
  });
});

describe('/api/auth — routes', () => {
  beforeEach(() => resetDb());

  it('GET /api/auth/me 401 without token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/me 200 with a valid session', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { player: Player; isAdmin: boolean };
    expect(body.player.id).toBe(player.id);
    expect(body.isAdmin).toBe(false);
  });

  it('GET /api/auth/me reflects admin status', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const { token } = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    const res = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    const body = res.json() as { isAdmin: boolean };
    expect(body.isAdmin).toBe(true);
    process.env.ADMIN_EMAILS = '';
  });

  it('POST /api/auth/logout 204 and deletes the session', async () => {
    const { token } = createHumanWithSession('Alice');
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: bearer(token) });
    expect(out.statusCode).toBe(204);
    const after = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it('POST /api/auth/google 400 without credential', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/google', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('POST /api/auth/google 401 with bogus credential', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/google', payload: { credential: 'not-a-jwt' } });
    expect(res.statusCode).toBe(401);
  });

  it('GET /api/auth/config returns enabled flag', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
    const body = res.json() as { enabled: boolean; googleClientId: string | null };
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('googleClientId');
  });
});
