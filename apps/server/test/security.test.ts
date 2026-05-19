import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { handleX01Turn } from '../src/socket-handler.js';
import { isValidDart, parseDartScore } from '../src/darts.js';
import {
  bearer,
  createHumanWithSession,
  createStubIo,
  createX01Game,
  fullState,
  resetDb,
} from './helpers.js';
import type { Player } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false });
});

describe('C1 — server recomputes scoreTotal from darts', () => {
  beforeEach(() => resetDb());

  it('darts present: client-claimed scoreTotal is ignored', () => {
    const { player: a } = createHumanWithSession('Alice');
    const { player: b } = createHumanWithSession('Bob');
    const gameId = createX01Game('501', [a.id, b.id]);
    const { io } = createStubIo();

    // Caller claims 441 — server should still compute 180 from the darts.
    handleX01Turn(io, gameId, a.id, ['T20', 'T20', 'T20'], 441, 1, fullState(gameId));

    const s = fullState(gameId);
    expect(s.scores[a.id]).toBe(321); // 501 - 180, NOT 501 - 441
    expect(s.turns[0]!.score_total).toBe(180);
  });

  it('darts present with bogus values: invalid darts treated as 0', () => {
    expect(parseDartScore('T99')).toBe(0);
    expect(parseDartScore('Z20')).toBe(0);
    expect(parseDartScore('T21')).toBe(0);
    expect(parseDartScore('D99')).toBe(0);
    expect(isValidDart('T99')).toBe(false);
    expect(isValidDart('S20')).toBe(true);
    expect(isValidDart('DB')).toBe(true);
  });

  it('empty darts: scoreTotal > 180 rejected (no turn recorded)', () => {
    const { player: a } = createHumanWithSession('Alice');
    const { player: b } = createHumanWithSession('Bob');
    const gameId = createX01Game('501', [a.id, b.id]);
    const { io } = createStubIo();

    handleX01Turn(io, gameId, a.id, [], 999, 1, fullState(gameId));

    const s = fullState(gameId);
    expect(s.scores[a.id]).toBe(501);
    expect(s.turns).toHaveLength(0);
  });

  it('empty darts: negative scoreTotal rejected', () => {
    const { player: a } = createHumanWithSession('Alice');
    const { player: b } = createHumanWithSession('Bob');
    const gameId = createX01Game('501', [a.id, b.id]);
    const { io } = createStubIo();

    handleX01Turn(io, gameId, a.id, [], -100, 1, fullState(gameId));

    const s = fullState(gameId);
    expect(s.scores[a.id]).toBe(501);
    expect(s.turns).toHaveLength(0);
  });
});

describe('C3 — empty-darts checkout busts (cannot prove double-out)', () => {
  beforeEach(() => resetDb());

  it('empty darts that would land on 0 is recorded as bust, no win', () => {
    const { player: a } = createHumanWithSession('Alice');
    const { player: b } = createHumanWithSession('Bob');
    const gameId = createX01Game('301', [a.id, b.id]);
    const { io } = createStubIo();

    // Drive Alice to 60 first (need real turns to set the score).
    handleX01Turn(io, gameId, a.id, ['T20', 'T20', 'T20'], null, 1, fullState(gameId)); // -> 121
    handleX01Turn(io, gameId, b.id, ['0', '0', '0'], null, 1, fullState(gameId));
    handleX01Turn(io, gameId, a.id, ['T20', '0', '0'], null, 2, fullState(gameId));     // -> 61
    handleX01Turn(io, gameId, b.id, ['0', '0', '0'], null, 2, fullState(gameId));

    // Quick-entry: scoreTotal=61 with empty darts → should bust.
    handleX01Turn(io, gameId, a.id, [], 61, 3, fullState(gameId));

    const s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.scores[a.id]).toBe(61);
    const aliceTurns = s.turns.filter((t) => t.player_id === a.id);
    const last = aliceTurns[aliceTurns.length - 1]!;
    expect(last.is_bust).toBe(1);
  });
});

describe('C4 — DELETE /api/games/:id requires participation', () => {
  beforeEach(() => resetDb());

  it('non-participant gets 403, game not deleted', async () => {
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const charlie = createHumanWithSession('Charlie');

    // Alice + Bob's game.
    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };

    // Charlie tries to delete.
    const del = await app.inject({
      method: 'DELETE', url: `/api/games/${id}`, headers: bearer(charlie.token),
    });
    expect(del.statusCode).toBe(403);

    // Verify the game still exists.
    const stillThere = db.prepare('SELECT 1 FROM games WHERE id = ?').get(id);
    expect(stillThere).toBeTruthy();
  });

  it('participant can delete', async () => {
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };

    const del = await app.inject({
      method: 'DELETE', url: `/api/games/${id}`, headers: bearer(alice.token),
    });
    expect(del.statusCode).toBe(204);
  });

  it('admin can delete any game', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });

    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };

    const del = await app.inject({
      method: 'DELETE', url: `/api/games/${id}`, headers: bearer(boss.token),
    });
    expect(del.statusCode).toBe(204);
    process.env.ADMIN_EMAILS = '';
  });
});

describe('H1 — GET /api/games/:id requires participation', () => {
  beforeEach(() => resetDb());

  it('non-participant gets 403', async () => {
    const alice = createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const charlie = createHumanWithSession('Charlie');

    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };

    const get = await app.inject({
      method: 'GET', url: `/api/games/${id}`, headers: bearer(charlie.token),
    });
    expect(get.statusCode).toBe(403);
  });

  it('participant gets the game, sees their own PII but not the counterpart\'s', async () => {
    const alice = createHumanWithSession('Alice', { email: 'alice@x.com', googleId: 'g_alice' });
    const bob = createHumanWithSession('Bob', { email: 'bob@x.com', googleId: 'g_bob' });

    const create = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(alice.token),
      payload: { mode: '501', player_ids: [alice.player.id, bob.player.id] },
    });
    const { id } = create.json() as { id: number };

    const get = await app.inject({
      method: 'GET', url: `/api/games/${id}`, headers: bearer(alice.token),
    });
    expect(get.statusCode).toBe(200);
    const body = get.json() as { players: Player[] };
    const aliceP = body.players.find((p) => p.id === alice.player.id)!;
    const bobP = body.players.find((p) => p.id === bob.player.id)!;
    expect(aliceP.email).toBe('alice@x.com');
    expect(aliceP.google_id).toBe('g_alice');
    expect(bobP.email).toBeNull();
    expect(bobP.google_id).toBeNull();
  });
});

describe('H2 — GET /api/stats/players/:id strips PII for other users', () => {
  beforeEach(() => resetDb());

  it('strips email + google_id when viewing another user', async () => {
    const alice = createHumanWithSession('Alice', { email: 'alice@x.com', googleId: 'g_alice' });
    const bob = createHumanWithSession('Bob', { email: 'bob@x.com', googleId: 'g_bob' });

    const res = await app.inject({
      method: 'GET', url: `/api/stats/players/${bob.player.id}`, headers: bearer(alice.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { player: Player };
    expect(body.player.email).toBeNull();
    expect(body.player.google_id).toBeNull();
  });

  it('keeps PII when viewing self', async () => {
    const alice = createHumanWithSession('Alice', { email: 'alice@x.com', googleId: 'g_alice' });

    const res = await app.inject({
      method: 'GET', url: `/api/stats/players/${alice.player.id}`, headers: bearer(alice.token),
    });
    const body = res.json() as { player: Player };
    expect(body.player.email).toBe('alice@x.com');
    expect(body.player.google_id).toBe('g_alice');
  });
});

describe('H3 — GET /api/players strips PII for other users', () => {
  beforeEach(() => resetDb());

  it('returns own PII but blanks others', async () => {
    const alice = createHumanWithSession('Alice', { email: 'alice@x.com', googleId: 'g_alice' });
    const bob = createHumanWithSession('Bob', { email: 'bob@x.com', googleId: 'g_bob' });

    const res = await app.inject({
      method: 'GET', url: '/api/players', headers: bearer(alice.token),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Player[];
    const aliceRow = body.find((p) => p.id === alice.player.id)!;
    const bobRow = body.find((p) => p.id === bob.player.id)!;
    expect(aliceRow.email).toBe('alice@x.com');
    expect(bobRow.email).toBeNull();
    expect(bobRow.google_id).toBeNull();
  });

  it('admin sees everyone\'s PII', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const boss = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    createHumanWithSession('Other', { email: 'other@x.com', googleId: 'g_other' });

    const res = await app.inject({
      method: 'GET', url: '/api/players', headers: bearer(boss.token),
    });
    const body = res.json() as Player[];
    const other = body.find((p) => p.name === 'Other')!;
    expect(other.email).toBe('other@x.com');
    process.env.ADMIN_EMAILS = '';
  });
});

describe('M1 — player name length cap', () => {
  beforeEach(() => resetDb());

  it('POST /api/players rejects > 50 character name', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/players', headers: bearer(token),
      payload: { name: 'x'.repeat(51) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/players/:id rejects > 50 character name', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'PUT', url: `/api/players/${player.id}`, headers: bearer(token),
      payload: { name: 'y'.repeat(51) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('exactly 50 chars accepted', async () => {
    const { token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/players', headers: bearer(token),
      payload: { name: 'z'.repeat(50) },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('M4 — clearer game-create errors', () => {
  beforeEach(() => resetDb());

  it('unknown player_id returns 400 with descriptive error', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, 999999] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: expect.stringContaining('999999') });
  });

  it('duplicate player_ids returns 400', async () => {
    const { player, token } = createHumanWithSession('Alice');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, player.id] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('caller must be a participant in their own created game (403 when not)', async () => {
    createHumanWithSession('Alice');
    const bob = createHumanWithSession('Bob');
    const carol = createHumanWithSession('Carol');
    const charlie = createHumanWithSession('Charlie');
    const res = await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(charlie.token),
      payload: { mode: '501', player_ids: [bob.player.id, carol.player.id] },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('H5 — rate limit fires after threshold', () => {
  it('the same bearer token bursting past the limit gets 429', async () => {
    const limited = await buildApp({ logger: false, rateLimit: { max: 5, timeWindow: '1 minute' } });
    const { token } = createHumanWithSession('Burst');

    const results: number[] = [];
    for (let i = 0; i < 8; i++) {
      const r = await limited.inject({ method: 'GET', url: '/api/players', headers: bearer(token) });
      results.push(r.statusCode);
    }
    // First 5 succeed, remainder rate-limited.
    expect(results.filter((c) => c === 200).length).toBe(5);
    expect(results.filter((c) => c === 429).length).toBeGreaterThan(0);
    await limited.close();
  });
});
