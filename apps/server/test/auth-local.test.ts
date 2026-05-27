import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';

// The test env has no GOOGLE_CLIENT_ID, so localAuthEnabled is true here.
// (The production path — /api/auth/local returning 404 when Google IS
// configured — is verified by a live smoke; it can't be toggled in-process
// because oauthClient is fixed at module load.)

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

describe('GET /api/auth/config', () => {
  it('advertises localAuth when Google is unconfigured', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { googleClientId: string | null; enabled: boolean; localAuth: boolean };
    expect(b.googleClientId).toBeNull();
    expect(b.enabled).toBe(false);
    expect(b.localAuth).toBe(true);
  });
});

describe('POST /api/auth/local — self-hosted sign-in', () => {
  beforeEach(() => resetDb());

  it('issues a working admin session for a given name', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Dave' } });
    expect(res.statusCode).toBe(200);
    const b = res.json() as { player: { id: number; name: string }; token: string; isAdmin: boolean };
    expect(b.player.name).toBe('Dave');
    expect(b.isAdmin).toBe(true);
    expect(typeof b.token).toBe('string');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(b.token) });
    expect(me.statusCode).toBe(200);
    expect((me.json() as { player: { id: number } }).player.id).toBe(b.player.id);
  });

  it('defaults a blank name to "Player"', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/local', payload: {} });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { player: { name: string } }).player.name).toBe('Player');
  });

  it('reuses an existing player with the same name (no duplicate account)', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Sam' } });
    const r2 = await app.inject({ method: 'POST', url: '/api/auth/local', payload: { name: 'Sam' } });
    expect((r1.json() as { player: { id: number } }).player.id)
      .toBe((r2.json() as { player: { id: number } }).player.id);
  });

  it('does NOT grant admin to ordinary (non-sentinel) users in local mode', async () => {
    // Regression guard: isAdmin must stay scoped to the local sentinel email,
    // not become blanket-true whenever Google is unconfigured.
    const { token } = createHumanWithSession('Normal'); // email null
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: bearer(token) });
    expect((me.json() as { isAdmin: boolean }).isAdmin).toBe(false);
  });
});
