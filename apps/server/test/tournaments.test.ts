import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import {
  bearer, createHuman, createHumanWithSession, resetDb, createStubIo, playOutWithAi,
} from './helpers.js';
import type { TournamentStateDto } from '../src/tournament-store.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

async function createKnockout(token: string, playerIds: number[], body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST', url: '/api/tournaments', headers: bearer(token),
    payload: { name: 'Cup', format: 'knockout', mode: '501', playerIds, ...body },
  });
}

describe('POST /api/tournaments — validation', () => {
  beforeEach(() => resetDb());

  it('creates a 4-player knockout and generates the bracket', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const res = await createKnockout(token, ids);
    expect(res.statusCode).toBe(201);
    const t = res.json() as TournamentStateDto;
    expect(t.format).toBe('knockout');
    expect(t.status).toBe('in_progress');
    expect(t.players).toHaveLength(4);
    // 4-bracket = 2 + 1 = 3 matches; both round-1 ready, final pending.
    expect(t.matches).toHaveLength(3);
    expect(t.matches.filter((m) => m.roundNum === 1 && m.status === 'ready')).toHaveLength(2);
  });

  it('rejects fewer than 2 players (400)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const res = await createKnockout(token, [player.id]);
    expect(res.statusCode).toBe(400);
  });

  it('rejects groups_knockout for now (400)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const res = await createKnockout(token, ids, { format: 'groups_knockout' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a creator who is not a participant (403)', async () => {
    const { token } = createHumanWithSession('Org');
    const res = await createKnockout(token, [createHuman('B'), createHuman('C')]);
    expect(res.statusCode).toBe(403);
  });

  it('requires auth (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/tournaments', payload: { name: 'x' } });
    expect(res.statusCode).toBe(401);
  });

  it('pads odd rosters with byes (3 players → 8? no, 4-bracket with 1 bye)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C')];
    const t = (await createKnockout(token, ids)).json() as TournamentStateDto;
    const byes = t.matches.filter((m) => m.status === 'bye');
    expect(byes).toHaveLength(1);
    expect(byes[0]!.winnerId).toBe(player.id); // top seed gets the bye
  });
});

describe('GET / scoping', () => {
  beforeEach(() => resetDb());

  it('non-participant cannot read a tournament (403)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B')];
    const t = (await createKnockout(token, ids)).json() as TournamentStateDto;
    const stranger = createHumanWithSession('Stranger');
    const res = await app.inject({ method: 'GET', url: `/api/tournaments/${t.id}`, headers: bearer(stranger.token) });
    expect(res.statusCode).toBe(403);
  });

  it('list returns only tournaments you created or play in', async () => {
    const a = createHumanWithSession('A');
    await createKnockout(a.token, [a.player.id, createHuman('B')]);
    const stranger = createHumanWithSession('Stranger');
    const res = await app.inject({ method: 'GET', url: '/api/tournaments', headers: bearer(stranger.token) });
    expect(res.json()).toHaveLength(0);
  });
});

describe('launch + settle + advance (full knockout play-through)', () => {
  beforeEach(() => resetDb());

  it('plays a 4-player bracket to a champion, advancing each round', async () => {
    const { io } = createStubIo();
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B'), createHuman('C'), createHuman('D')];
    const t0 = (await createKnockout(token, ids)).json() as TournamentStateDto;

    const r1 = t0.matches.filter((m) => m.roundNum === 1).sort((a, b) => a.matchIndex - b.matchIndex);
    // Launch + play out both semi-finals.
    for (const m of r1) {
      const launch = await app.inject({
        method: 'POST', url: `/api/tournaments/${t0.id}/matches/${m.id}/launch`, headers: bearer(token),
      });
      expect(launch.statusCode).toBe(200);
      const { gameId } = launch.json() as { gameId: number };
      playOutWithAi(io, gameId);
    }

    // Both semis settled → final ready with both slots filled.
    const t1 = (await app.inject({ method: 'GET', url: `/api/tournaments/${t0.id}`, headers: bearer(token) }))
      .json() as TournamentStateDto;
    const final = t1.matches.find((m) => m.roundNum === 2)!;
    expect(final.status).toBe('ready');
    expect(final.homePlayerId).not.toBeNull();
    expect(final.awayPlayerId).not.toBeNull();
    expect(t1.players.filter((p) => p.eliminated)).toHaveLength(2);

    // Play the final.
    const launchFinal = await app.inject({
      method: 'POST', url: `/api/tournaments/${t0.id}/matches/${final.id}/launch`, headers: bearer(token),
    });
    const { gameId: finalGame } = launchFinal.json() as { gameId: number };
    playOutWithAi(io, finalGame);

    const t2 = (await app.inject({ method: 'GET', url: `/api/tournaments/${t0.id}`, headers: bearer(token) }))
      .json() as TournamentStateDto;
    expect(t2.status).toBe('completed');
    expect(t2.winnerId).not.toBeNull();
    expect([final.homePlayerId, final.awayPlayerId]).toContain(t2.winnerId);
    expect(io.constructor).toBeDefined();
  });

  it('launch is idempotent — relaunching returns the same game', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B')];
    const t = (await createKnockout(token, ids)).json() as TournamentStateDto;
    const m = t.matches[0]!;
    const a = await app.inject({ method: 'POST', url: `/api/tournaments/${t.id}/matches/${m.id}/launch`, headers: bearer(token) });
    const b = await app.inject({ method: 'POST', url: `/api/tournaments/${t.id}/matches/${m.id}/launch`, headers: bearer(token) });
    expect((a.json() as { gameId: number }).gameId).toBe((b.json() as { gameId: number }).gameId);
  });

  it('rejects launch by a non-organiser (403)', async () => {
    const { player, token } = createHumanWithSession('Org');
    const friend = createHumanWithSession('Friend');
    const ids = [player.id, friend.player.id];
    const t = (await createKnockout(token, ids)).json() as TournamentStateDto;
    const m = t.matches[0]!;
    const res = await app.inject({
      method: 'POST', url: `/api/tournaments/${t.id}/matches/${m.id}/launch`, headers: bearer(friend.token),
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE removes the tournament and its scheduled games', async () => {
    const { player, token } = createHumanWithSession('Org');
    const ids = [player.id, createHuman('B')];
    const t = (await createKnockout(token, ids)).json() as TournamentStateDto;
    const m = t.matches[0]!;
    const { gameId } = (await app.inject({
      method: 'POST', url: `/api/tournaments/${t.id}/matches/${m.id}/launch`, headers: bearer(token),
    })).json() as { gameId: number };

    const del = await app.inject({ method: 'DELETE', url: `/api/tournaments/${t.id}`, headers: bearer(token) });
    expect(del.statusCode).toBe(204);
    // Backing game is gone too.
    const game = await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers: bearer(token) });
    expect(game.statusCode).toBe(404);
  });
});
