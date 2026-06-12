import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { bearer, createHumanWithSession, resetDb } from './helpers.js';
import type { TournamentStateDto } from '../src/tournament-store.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

async function createOnline(token: string, targetSize = 4, body: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST', url: '/api/tournaments', headers: bearer(token),
    payload: { name: 'Online Cup', format: 'knockout', mode: '501', isOnline: true, targetSize, ...body },
  });
  return res;
}

describe('Phase 9 T5 — online tournament lifecycle', () => {
  beforeEach(() => resetDb());

  it('creates a setup lobby with an invite code and only the host', async () => {
    const { token } = createHumanWithSession('Host');
    const res = await createOnline(token, 4);
    expect(res.statusCode).toBe(201);
    const t = res.json() as TournamentStateDto;
    expect(t.status).toBe('setup');
    expect(t.isOnline).toBe(true);
    expect(t.inviteCode).toMatch(/^[A-Z2-9]{5}$/);
    expect(t.targetSize).toBe(4);
    expect(t.players).toHaveLength(1);
    expect(t.matches).toHaveLength(0); // bracket not generated until start
  });

  it('rejects a missing/invalid target size (400)', async () => {
    const { token } = createHumanWithSession('Host');
    const res = await createOnline(token, 1);
    expect(res.statusCode).toBe(400);
  });

  it('lets players join by code and auto-starts when full', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 2)).json() as TournamentStateDto;
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/tournaments/join', headers: bearer(friend.token), payload: { code: t.inviteCode },
    });
    expect(res.statusCode).toBe(200);
    const joined = res.json() as TournamentStateDto;
    // target 2 reached → auto-start.
    expect(joined.status).toBe('in_progress');
    expect(joined.players).toHaveLength(2);
    expect(joined.matches).toHaveLength(1);
    expect(joined.matches[0]!.status).toBe('ready');
  });

  it('join is idempotent for the host', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 4)).json() as TournamentStateDto;
    const res = await app.inject({
      method: 'POST', url: '/api/tournaments/join', headers: bearer(host.token), payload: { code: t.inviteCode },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as TournamentStateDto).players).toHaveLength(1);
  });

  it('404 for an unknown code', async () => {
    const p = createHumanWithSession('P');
    const res = await app.inject({
      method: 'POST', url: '/api/tournaments/join', headers: bearer(p.token), payload: { code: 'ZZZZZ' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('409 when the lobby is already full', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 2)).json() as TournamentStateDto;
    const a = createHumanWithSession('A');
    await app.inject({ method: 'POST', url: '/api/tournaments/join', headers: bearer(a.token), payload: { code: t.inviteCode } });
    const b = createHumanWithSession('B');
    const res = await app.inject({ method: 'POST', url: '/api/tournaments/join', headers: bearer(b.token), payload: { code: t.inviteCode } });
    expect(res.statusCode).toBe(409); // started + full
  });

  it('organiser can start early with fewer than target players', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 4)).json() as TournamentStateDto;
    const friend = createHumanWithSession('Friend');
    await app.inject({ method: 'POST', url: '/api/tournaments/join', headers: bearer(friend.token), payload: { code: t.inviteCode } });
    const start = await app.inject({ method: 'POST', url: `/api/tournaments/${t.id}/start`, headers: bearer(host.token) });
    expect(start.statusCode).toBe(200);
    expect((start.json() as TournamentStateDto).status).toBe('in_progress');
  });

  it('non-organiser cannot start (403)', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 4)).json() as TournamentStateDto;
    const friend = createHumanWithSession('Friend');
    await app.inject({ method: 'POST', url: '/api/tournaments/join', headers: bearer(friend.token), payload: { code: t.inviteCode } });
    const res = await app.inject({ method: 'POST', url: `/api/tournaments/${t.id}/start`, headers: bearer(friend.token) });
    expect(res.statusCode).toBe(403);
  });

  it('a match participant can launch their tie, and the game is online (maxPlayers 2)', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 2)).json() as TournamentStateDto;
    const friend = createHumanWithSession('Friend');
    const started = (await app.inject({
      method: 'POST', url: '/api/tournaments/join', headers: bearer(friend.token), payload: { code: t.inviteCode },
    })).json() as TournamentStateDto;
    const m = started.matches[0]!;

    // Friend (a participant, not the organiser) can launch.
    const launch = await app.inject({
      method: 'POST', url: `/api/tournaments/${t.id}/matches/${m.id}/launch`, headers: bearer(friend.token),
    });
    expect(launch.statusCode).toBe(200);
    const { gameId } = launch.json() as { gameId: number };

    const game = (await app.inject({ method: 'GET', url: `/api/games/${gameId}`, headers: bearer(host.token) }))
      .json() as { is_online: number; parsed_settings: { maxPlayers?: number }; players: unknown[] };
    expect(game.is_online).toBe(1);
    expect(game.parsed_settings.maxPlayers).toBe(2);
    expect(game.players).toHaveLength(2);
  });

  it('a non-participant cannot launch an online match (403)', async () => {
    const host = createHumanWithSession('Host');
    const t = (await createOnline(host.token, 2)).json() as TournamentStateDto;
    const friend = createHumanWithSession('Friend');
    const started = (await app.inject({
      method: 'POST', url: '/api/tournaments/join', headers: bearer(friend.token), payload: { code: t.inviteCode },
    })).json() as TournamentStateDto;
    const stranger = createHumanWithSession('Stranger');
    const res = await app.inject({
      method: 'POST', url: `/api/tournaments/${t.id}/matches/${started.matches[0]!.id}/launch`, headers: bearer(stranger.token),
    });
    expect(res.statusCode).toBe(403);
  });
});
