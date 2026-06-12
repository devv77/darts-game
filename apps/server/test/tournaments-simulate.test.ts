import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHuman, createHumanWithSession, getAi, resetDb } from './helpers.js';
import type { TournamentStateDto } from '../src/tournament-store.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

describe('Phase 9 T4 — simulate all-AI matches', () => {
  beforeEach(() => resetDb());

  it('simulates an all-AI knockout match and advances the bracket', async () => {
    const { token } = createHumanWithSession('Org', { email: 'boss@x.com', googleId: 'g_boss' });
    process.env.ADMIN_EMAILS = 'boss@x.com'; // organiser can simulate
    const ai = [getAi(3), getAi(5), getAi(7), getAi(9)];
    const t0 = (await app.inject({
      method: 'POST', url: '/api/tournaments', headers: bearer(token),
      payload: { name: 'Bots', format: 'knockout', mode: '501', playerIds: ai.map((a) => a.id) },
    })).json() as TournamentStateDto;

    const semi = t0.matches.find((m) => m.roundNum === 1 && m.status === 'ready')!;
    const res = await app.inject({
      method: 'POST', url: `/api/tournaments/${t0.id}/matches/${semi.id}/simulate`, headers: bearer(token),
    });
    expect(res.statusCode).toBe(200);
    const t1 = res.json() as TournamentStateDto;
    const settled = t1.matches.find((m) => m.id === semi.id)!;
    expect(settled.status).toBe('completed');
    expect(settled.winnerId).not.toBeNull();
    process.env.ADMIN_EMAILS = '';
  });

  it('rejects simulating a match with a human player (400)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const t0 = (await app.inject({
      method: 'POST', url: '/api/tournaments', headers: bearer(token),
      payload: { name: 'Mixed', format: 'knockout', mode: '501', playerIds: [player.id, getAi(5).id] },
    })).json() as TournamentStateDto;
    const m = t0.matches.find((x) => x.status === 'ready')!;
    const res = await app.inject({
      method: 'POST', url: `/api/tournaments/${t0.id}/matches/${m.id}/simulate`, headers: bearer(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it('simulating every fixture runs a full bot tournament to a champion', async () => {
    const { token } = createHumanWithSession('Org', { email: 'boss@x.com', googleId: 'g_boss2' });
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const ai = [getAi(2), getAi(4), getAi(6), getAi(8)];
    const t0 = (await app.inject({
      method: 'POST', url: '/api/tournaments', headers: bearer(token),
      payload: { name: 'AllBots', format: 'knockout', mode: '301', playerIds: ai.map((a) => a.id) },
    })).json() as TournamentStateDto;

    let guard = 0;
    for (;;) {
      const st = (await app.inject({ method: 'GET', url: `/api/tournaments/${t0.id}`, headers: bearer(token) })).json() as TournamentStateDto;
      if (st.status === 'completed') { expect(st.winnerId).not.toBeNull(); break; }
      const ready = st.matches.find((m) => m.status === 'ready')!;
      await app.inject({ method: 'POST', url: `/api/tournaments/${t0.id}/matches/${ready.id}/simulate`, headers: bearer(token) });
      if (++guard > 10) throw new Error('did not converge');
    }
    process.env.ADMIN_EMAILS = '';
  });
});
