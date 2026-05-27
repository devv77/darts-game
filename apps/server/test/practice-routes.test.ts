import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';
import { LOCAL_ADMIN_EMAIL } from '../src/auth.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

interface StateResp {
  id: number;
  playerId: number;
  drillType: string;
  difficulty: string | null;
  targets: { label: string; hint?: string }[];
  results: { success: boolean; dartsUsed: number; scoreValue?: number }[];
  currentIndex: number;
  finished: boolean;
  metrics: { targetsTotal: number; targetsDone: number; dartsThrown: number; threeDartAvg?: number };
}

function create(token: string, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/api/practice', headers: bearer(token), payload: body });
}
function turn(token: string, id: number, body: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: `/api/practice/${id}/turn`, headers: bearer(token), payload: body });
}

describe('POST /api/practice — create', () => {
  beforeEach(() => resetDb());

  it('rejects unauthenticated (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/practice', payload: { playerId: 1, drillType: 'checkout' } });
    expect(res.statusCode).toBe(401);
  });

  it('creates a checkout session with 10 targets carrying hints', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await create(token, { playerId: player.id, drillType: 'checkout', difficulty: 'medium' });
    expect(res.statusCode).toBe(201);
    const s = res.json() as StateResp;
    expect(s.drillType).toBe('checkout');
    expect(s.difficulty).toBe('medium');
    expect(s.targets).toHaveLength(10);
    expect(s.targets.every((t) => typeof t.hint === 'string' && t.hint.length > 0)).toBe(true);
    expect(s.currentIndex).toBe(0);
    expect(s.finished).toBe(false);
    expect(s.metrics.targetsTotal).toBe(10);
  });

  it('generates the right target counts per drill', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const counts: Record<string, number> = { scoring: 10, around_the_clock: 21, doubles: 10 };
    for (const [drill, n] of Object.entries(counts)) {
      const res = await create(token, { playerId: player.id, drillType: drill });
      expect(res.statusCode).toBe(201);
      expect((res.json() as StateResp).targets).toHaveLength(n);
    }
  });

  it('rejects an invalid drillType (400)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await create(token, { playerId: player.id, drillType: 'roulette' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an invalid difficulty (400)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await create(token, { playerId: player.id, drillType: 'checkout', difficulty: 'insane' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a missing/garbage playerId (400)', async () => {
    const { token } = createHumanWithSession('Alice');
    expect((await create(token, { drillType: 'checkout' })).statusCode).toBe(400);
    expect((await create(token, { playerId: 'x', drillType: 'checkout' })).statusCode).toBe(400);
  });

  it('forbids creating a session for another player (403)', async () => {
    const { token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const res = await create(token, { playerId: bob.player.id, drillType: 'checkout' });
    expect(res.statusCode).toBe(403);
  });

  it('lets an admin create for another player', async () => {
    const admin = createHumanWithSession('Boss', { email: LOCAL_ADMIN_EMAIL });
    const bob = createHumanWithSession('Bob');
    const res = await create(admin.token, { playerId: bob.player.id, drillType: 'scoring' });
    expect(res.statusCode).toBe(201);
    expect((res.json() as StateResp).playerId).toBe(bob.player.id);
  });

  it('a non-admin gets 403 (not 400) for someone else\'s id — no existence probing', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await create(token, { playerId: 999999, drillType: 'checkout' });
    expect(res.statusCode).toBe(403);
  });

  it('an admin gets 400 for a genuinely unknown player id', async () => {
    const admin = createHumanWithSession('Boss', { email: LOCAL_ADMIN_EMAIL });
    const res = await create(admin.token, { playerId: 999999, drillType: 'checkout' });
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/practice/:id', () => {
  beforeEach(() => resetDb());

  it('returns the owner their session', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    const res = await app.inject({ method: 'GET', url: `/api/practice/${id}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(id);
  });

  it('forbids another player reading the session (403)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    const bob = createHumanWithSession('Bob');
    const res = await app.inject({ method: 'GET', url: `/api/practice/${id}`, headers: bearer(bob.token) });
    expect(res.statusCode).toBe(403);
  });

  it('404 for a missing session', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/practice/424242', headers: bearer(token) });
    expect(res.statusCode).toBe(404);
  });

  it('400 for a non-numeric id (no crash / injection)', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({ method: 'GET', url: '/api/practice/abc', headers: bearer(token) });
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/practice/:id/turn — drill rules', () => {
  beforeEach(() => resetDb());

  it('scoring: records a round and advances, finishes after 10 rounds', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    let s: StateResp = (await turn(token, id, { scoreTotal: 100 })).json();
    expect(s.currentIndex).toBe(1);
    expect(s.results[0]!.scoreValue).toBe(100);
    for (let i = 0; i < 9; i++) s = (await turn(token, id, { scoreTotal: 60 })).json();
    expect(s.finished).toBe(true);
    expect(s.metrics.threeDartAvg).toBeCloseTo((100 + 60 * 9) / 10, 1);
    // a turn on a finished session is rejected
    expect((await turn(token, id, { scoreTotal: 60 })).statusCode).toBe(409);
  });

  it('scoring: rejects out-of-range scoreTotal (400)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    expect((await turn(token, id, { scoreTotal: 200 })).statusCode).toBe(400);
    expect((await turn(token, id, { scoreTotal: -5 })).statusCode).toBe(400);
    expect((await turn(token, id, { darts: ['T20'] })).statusCode).toBe(400); // scoring needs scoreTotal
  });

  it('checkout: finishing on the suggested path succeeds; busting advances without a success', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const created = (await create(token, { playerId: player.id, drillType: 'checkout', difficulty: 'easy' })).json() as StateResp;
    const id = created.id;
    // The hint is a valid double-out path for target 0 → submit it verbatim.
    const hintDarts = created.targets[0]!.hint!.split(' ');
    let s: StateResp = (await turn(token, id, { darts: hintDarts })).json();
    expect(s.currentIndex).toBe(1);
    expect(s.results[0]!.success).toBe(true);
    // Bust the second target with 180 (always > any checkout) → advances, no success.
    s = (await turn(token, id, { darts: ['T20', 'T20', 'T20'] })).json();
    expect(s.currentIndex).toBe(2);
    expect(s.results[1]!.success).toBe(false);
  });

  it('checkout/darts drills: reject invalid dart notation and bad array sizes (400)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'checkout' })).json().id;
    expect((await turn(token, id, { darts: [] })).statusCode).toBe(400);
    expect((await turn(token, id, { darts: ['T20', 'T20', 'T20', 'T20'] })).statusCode).toBe(400);
    expect((await turn(token, id, { darts: ['Z9'] })).statusCode).toBe(400);
    expect((await turn(token, id, { darts: ['S25'] })).statusCode).toBe(400); // 25 isn't a valid single segment
  });

  it('doubles: hitting the exact double succeeds', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const created = (await create(token, { playerId: player.id, drillType: 'doubles' })).json() as StateResp;
    const label = created.targets[0]!.label; // e.g. "D16" or "Bull"
    const dart = label === 'Bull' ? 'DB' : label;
    const s: StateResp = (await turn(token, created.id, { darts: [dart] })).json();
    expect(s.results[0]!.success).toBe(true);
    expect(s.currentIndex).toBe(1);
  });

  it('around_the_clock: hitting the current segment (any multiplier) advances', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const created = (await create(token, { playerId: player.id, drillType: 'around_the_clock' })).json() as StateResp;
    const label = created.targets[0]!.label; // "1".."20" | "Bull"
    const dart = label === 'Bull' ? 'SB' : 'T' + label; // treble still counts as that segment
    const s: StateResp = (await turn(token, created.id, { darts: [dart] })).json();
    expect(s.currentIndex).toBe(1);
  });

  it('forbids another player submitting a turn (403)', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    const bob = createHumanWithSession('Bob');
    expect((await turn(bob.token, id, { scoreTotal: 60 })).statusCode).toBe(403);
  });
});

describe('GET /api/practice/history/:playerId', () => {
  beforeEach(() => resetDb());

  it('records history when a session finishes', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const id = (await create(token, { playerId: player.id, drillType: 'scoring' })).json().id;
    for (let i = 0; i < 10; i++) await turn(token, id, { scoreTotal: 80 });
    const res = await app.inject({ method: 'GET', url: `/api/practice/history/${player.id}`, headers: bearer(token) });
    expect(res.statusCode).toBe(200);
    const hist = res.json() as { drillType: string; metricValue: number }[];
    expect(hist.length).toBeGreaterThanOrEqual(1);
    expect(hist.every((h) => h.drillType === 'scoring' && typeof h.metricValue === 'number')).toBe(true);
  });

  it('forbids reading another player history (403) and validates the id (400)', async () => {
    const { token } = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    expect((await app.inject({ method: 'GET', url: `/api/practice/history/${bob.player.id}`, headers: bearer(token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/practice/history/abc', headers: bearer(token) })).statusCode).toBe(400);
  });
});
