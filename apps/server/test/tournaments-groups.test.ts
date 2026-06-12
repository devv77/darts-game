import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHuman, createHumanWithSession, resetDb, createStubIo, playOutWithAi } from './helpers.js';
import type { TournamentStateDto } from '../src/tournament-store.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

async function getState(token: string, id: number): Promise<TournamentStateDto> {
  return (await app.inject({ method: 'GET', url: `/api/tournaments/${id}`, headers: bearer(token) })).json() as TournamentStateDto;
}

describe('Phase 9 T3 — groups → knockout', () => {
  beforeEach(() => resetDb());

  it('validates group options', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const bad = await app.inject({
      method: 'POST', url: '/api/tournaments', headers: bearer(token),
      payload: { name: 'GK', format: 'groups_knockout', mode: '501', playerIds: ids, options: {} },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('creates a group stage and crowns a champion after groups feed the bracket', async () => {
    const { io } = createStubIo();
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, ...['B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n) => createHuman(n))];
    const create = await app.inject({
      method: 'POST', url: '/api/tournaments', headers: bearer(token),
      payload: {
        name: 'World Cup', format: 'groups_knockout', mode: '501', playerIds: ids,
        options: { groupCount: 2, advancePerGroup: 2 },
      },
    });
    expect(create.statusCode).toBe(201);
    const t0 = create.json() as TournamentStateDto;
    expect(t0.format).toBe('groups_knockout');
    // 2 groups of 4 → 6 RR matches each → 12 group matches, all 'group' stage.
    expect(t0.matches.filter((m) => m.stage === 'group')).toHaveLength(12);
    expect(t0.matches.some((m) => m.stage === 'ko')).toBe(false);
    expect(t0.groupStandings).not.toBeNull();
    expect(t0.groupStandings!).toHaveLength(2);
    expect(t0.players.every((p) => p.groupLabel === 'A' || p.groupLabel === 'B')).toBe(true);

    // Play every fixture that's ready, repeatedly — the KO stage appears mid-way.
    let guard = 0;
    for (;;) {
      const st = await getState(token, t0.id);
      if (st.status === 'completed') break;
      const ready = st.matches.find((m) => m.status === 'ready');
      expect(ready, 'a ready match should exist until completion').toBeTruthy();
      const { gameId } = (await app.inject({
        method: 'POST', url: `/api/tournaments/${t0.id}/matches/${ready!.id}/launch`, headers: bearer(token),
      })).json() as { gameId: number };
      playOutWithAi(io, gameId);
      if (++guard > 40) throw new Error('did not converge');
    }

    const done = await getState(token, t0.id);
    expect(done.status).toBe('completed');
    expect(done.winnerId).not.toBeNull();
    // KO stage was generated: 4 qualifiers → 2 semis + 1 final.
    expect(done.matches.filter((m) => m.stage === 'ko')).toHaveLength(3);
    // Champion is one of the four group qualifiers.
    const koPlayers = new Set(done.matches.filter((m) => m.stage === 'ko').flatMap((m) => [m.homePlayerId, m.awayPlayerId]));
    expect(koPlayers.has(done.winnerId)).toBe(true);
  });
});
