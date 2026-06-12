import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHuman, createHumanWithSession, resetDb, createStubIo, playOutWithAi } from './helpers.js';
import type { TournamentStateDto } from '../src/tournament-store.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

async function createLeague(token: string, playerIds: number[], options: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST', url: '/api/tournaments', headers: bearer(token),
    payload: { name: 'League', format: 'league', mode: '501', playerIds, options },
  });
}

describe('Phase 9 T2 — league', () => {
  beforeEach(() => resetDb());

  it('creates a 4-player single round-robin (6 fixtures, all ready)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const res = await createLeague(token, ids);
    expect(res.statusCode).toBe(201);
    const t = res.json() as TournamentStateDto;
    expect(t.format).toBe('league');
    expect(t.matches).toHaveLength(6);
    expect(t.matches.every((m) => m.status === 'ready')).toBe(true);
    expect(t.standings).not.toBeNull();
    expect(t.standings!).toHaveLength(4);
  });

  it('double round-robin doubles the fixtures', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C')];
    const t = (await createLeague(token, ids, { doubleRoundRobin: true })).json() as TournamentStateDto;
    expect(t.matches).toHaveLength(6); // C(3,2)=3, doubled
  });

  it('plays every fixture → standings populate and a champion is crowned', async () => {
    const { io } = createStubIo();
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const t0 = (await createLeague(token, ids)).json() as TournamentStateDto;

    for (const m of t0.matches) {
      const { gameId } = (await app.inject({
        method: 'POST', url: `/api/tournaments/${t0.id}/matches/${m.id}/launch`, headers: bearer(token),
      })).json() as { gameId: number };
      playOutWithAi(io, gameId);
    }

    const t1 = (await app.inject({ method: 'GET', url: `/api/tournaments/${t0.id}`, headers: bearer(token) }))
      .json() as TournamentStateDto;
    expect(t1.status).toBe('completed');
    expect(t1.winnerId).not.toBeNull();
    expect(t1.standings!.every((r) => r.played === 3)).toBe(true); // 4 players → 3 games each
    // Champion is the top of the table.
    expect(t1.winnerId).toBe(t1.standings![0]!.playerId);
    const totalPoints = t1.standings!.reduce((s, r) => s + r.points, 0);
    expect(totalPoints).toBe(6 * 2); // 6 matches × 2 points each (no draws in x01)
  });
});
