import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { bearer, createHumanWithSession, getAi, resetDb } from './helpers.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ logger: false, rateLimit: false, helmet: false });
});

interface OnlineGame {
  id: number;
  invite_code: string | null;
  is_online: number;
  status: string;
  players: { id: number; position: number }[];
  parsed_settings: { maxPlayers?: number };
}

async function createOnlineGame(token: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/games',
    headers: bearer(token),
    payload: { mode: '501', settings: { format: 'single', maxPlayers: 2 }, is_online: true, ...body },
  });
}

describe('Phase 8a — online game creation', () => {
  beforeEach(() => resetDb());

  it('creates an online 501 game with just the host and issues an invite code', async () => {
    const { player, token } = createHumanWithSession('Host');
    const res = await createOnlineGame(token, { player_ids: [player.id] });
    expect(res.statusCode).toBe(201);
    const game = res.json() as OnlineGame;
    expect(game.is_online).toBe(1);
    expect(game.invite_code).toMatch(/^[A-Z2-9]{5}$/);
    expect(game.players).toHaveLength(1);
    expect(game.parsed_settings.maxPlayers).toBe(2);
  });

  it('rejects AI players in an online game (400)', async () => {
    const { player, token } = createHumanWithSession('Host');
    const ai = getAi(5);
    const res = await createOnlineGame(token, { player_ids: [player.id, ai.id] });
    expect(res.statusCode).toBe(400);
  });

  it('rejects more seeded players than the chosen capacity (400)', async () => {
    const { player, token } = createHumanWithSession('Host');
    const friend = createHumanWithSession('Friend');
    const third = createHumanWithSession('Third');
    const res = await createOnlineGame(token, {
      player_ids: [player.id, friend.player.id, third.player.id],
      settings: { format: 'single', maxPlayers: 2 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('clamps capacity into 2..4', async () => {
    const { player, token } = createHumanWithSession('Host');
    const res = await createOnlineGame(token, {
      player_ids: [player.id], settings: { format: 'single', maxPlayers: 99 },
    });
    const game = res.json() as OnlineGame;
    expect(game.parsed_settings.maxPlayers).toBe(4);
  });
});

describe('Phase 8a — joining by invite code', () => {
  beforeEach(() => resetDb());

  async function hostOnlineGame() {
    const { player, token } = createHumanWithSession('Host');
    const res = await createOnlineGame(token, { player_ids: [player.id] });
    return { host: player, hostToken: token, game: res.json() as OnlineGame };
  }

  it('lets a second player join and fills the seat', async () => {
    const { game } = await hostOnlineGame();
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: game.invite_code },
    });
    expect(res.statusCode).toBe(200);
    const joined = res.json() as OnlineGame;
    expect(joined.players).toHaveLength(2);
    expect(joined.players.map((p) => p.id)).toContain(friend.player.id);
  });

  it('accepts a lowercase / padded code', async () => {
    const { game } = await hostOnlineGame();
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: `  ${game.invite_code!.toLowerCase()}  ` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('is idempotent — re-joining your own game returns it (200)', async () => {
    const { hostToken, game } = await hostOnlineGame();
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(hostToken), payload: { code: game.invite_code },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as OnlineGame).players).toHaveLength(1);
  });

  it('404 for an unknown code', async () => {
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: 'ZZZZZ' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('400 when no code supplied', async () => {
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join', headers: bearer(friend.token), payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('409 when the game is already full', async () => {
    const { game } = await hostOnlineGame();
    const friend = createHumanWithSession('Friend');
    await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: game.invite_code },
    });
    const third = createHumanWithSession('Third');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(third.token), payload: { code: game.invite_code },
    });
    expect(res.statusCode).toBe(409);
  });

  it('409 once the game has started (a turn exists)', async () => {
    const { host, game } = await hostOnlineGame();
    // Simulate the match having begun by inserting a turn directly.
    db.prepare(
      `INSERT INTO turns (game_id, player_id, round_num, dart1, score_total, is_bust, set_num, leg_num)
       VALUES (?, ?, 1, 'T20', 60, 0, 1, 1)`
    ).run(game.id, host.id);
    const friend = createHumanWithSession('Friend');
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: game.invite_code },
    });
    expect(res.statusCode).toBe(409);
  });

  it('does not expose non-online games via the join endpoint (404)', async () => {
    const { player, token } = createHumanWithSession('Host');
    const friend = createHumanWithSession('Friend');
    // A normal (offline) 2-player game has no invite code; a guessed code 404s.
    await app.inject({
      method: 'POST', url: '/api/games', headers: bearer(token),
      payload: { mode: '501', player_ids: [player.id, friend.player.id] },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/games/join',
      headers: bearer(friend.token), payload: { code: 'ABCDE' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('requires authentication (401)', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/games/join', payload: { code: 'ABCDE' } });
    expect(res.statusCode).toBe(401);
  });
});
