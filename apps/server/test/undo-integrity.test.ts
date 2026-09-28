import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { db } from '../src/db.js';
import { handleX01Turn, undoLastTurn, undoPlan } from '../src/socket-handler.js';
import { createTournament, launchMatch, getTournamentRow } from '../src/tournament-store.js';
import {
  bearer, createHuman, createHumanWithSession, createStubIo, createX01Game, fullState, getAi, resetDb,
} from './helpers.js';
import type { Player } from '../src/types.js';

beforeEach(() => {
  resetDb();
  process.env.ADMIN_EMAILS = '';
});

function throwFor(gameId: number, playerId: number, darts: string[]) {
  const { io } = createStubIo();
  const st = fullState(gameId);
  handleX01Turn(io, gameId, playerId, darts, null, st.current_round, st);
}
const player = (id: number) => db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;

// DR-H7: undo only ever allowed "your own last turn", so on a shared device the
// other local player's visits — and anything once the AI had replied — were
// impossible to take back.
describe('undoPlan — offline games (one shared device)', () => {
  it('the signed-in participant can undo the guest player\'s visit', () => {
    const { player: me } = createHumanWithSession('Me');
    const guest = createHuman('Guest');
    const gameId = createX01Game('501', [me.id, guest]);
    throwFor(gameId, me.id, ['T20', 'T20', 'T20']);
    throwFor(gameId, guest, ['S5', 'S1', '0']);
    expect(undoPlan(gameId, me)).toBe(1);
  });

  it('vs AI: undo takes back the AI reply AND my visit before it', () => {
    const { player: me } = createHumanWithSession('Me');
    const ai = getAi(3);
    const gameId = createX01Game('501', [me.id, ai.id]);
    throwFor(gameId, me.id, ['S20', 'S1', '0']);
    throwFor(gameId, ai.id, ['T20', 'T20', 'T20']);
    expect(undoPlan(gameId, me)).toBe(2);
    for (let i = 0; i < 2; i++) undoLastTurn(gameId);
    const st = fullState(gameId);
    expect(st.turns).toHaveLength(0);
    expect(st.players[st.current_player_index]!.id).toBe(me.id);
  });

  it('vs AI: nothing to undo while only the AI has thrown', () => {
    const { player: me } = createHumanWithSession('Me');
    const ai = getAi(3);
    const gameId = createX01Game('501', [ai.id, me.id]);
    throwFor(gameId, ai.id, ['T20', 'T20', 'T20']);
    expect(undoPlan(gameId, me)).toBe(0);
  });

  it('non-participants (non-admin) still cannot undo', () => {
    const { player: me } = createHumanWithSession('Me');
    const { player: stranger } = createHumanWithSession('Stranger');
    const gameId = createX01Game('501', [me.id, createHuman('B')]);
    throwFor(gameId, me.id, ['T20', 'T20', 'T20']);
    expect(undoPlan(gameId, stranger)).toBe(0);
  });
});

describe('undoPlan — online games keep "own visit only"', () => {
  it('cannot undo the opponent\'s visit, can undo own', () => {
    const { player: a } = createHumanWithSession('A');
    const { player: b } = createHumanWithSession('B');
    const gameId = createX01Game('501', [a.id, b.id]);
    db.prepare('UPDATE games SET is_online = 1 WHERE id = ?').run(gameId);
    throwFor(gameId, a.id, ['T20', 'T20', 'T20']);
    expect(undoPlan(gameId, b)).toBe(0);
    expect(undoPlan(gameId, a)).toBe(1);
  });
});

function knockout2(a: number, b: number, createdBy: number) {
  const tid = createTournament({
    name: 'Cup', format: 'knockout', mode: '301', matchSettings: { format: 'single' },
    options: {}, playerIds: [a, b], createdBy,
  });
  const match = db.prepare('SELECT id FROM tournament_matches WHERE tournament_id = ?').get(tid) as { id: number };
  return { tid, matchId: match.id, gameId: launchMatch(tid, match.id) };
}

// DR-H4: undoing the winning visit reopened the game, but the match was already
// settled and advanced, and a re-finish never re-settled it.
describe('undoPlan — settled tournament games', () => {
  it('refuses undo on a completed tournament game, even for an admin', () => {
    const { player: a } = createHumanWithSession('A', { email: 'boss@x.com', googleId: 'g_a' });
    const b = createHuman('B');
    const { tid, gameId } = knockout2(a.id, b, a.id);
    throwFor(gameId, a.id, ['T20', 'T20', 'T20']); // 121
    throwFor(gameId, b, ['0', '0', '0']);
    throwFor(gameId, a.id, ['T20', 'T11', 'D14']); // 121 → 0
    expect(fullState(gameId).status).toBe('completed');
    expect(getTournamentRow(tid)!.status).toBe('completed');
    expect(undoPlan(gameId, a)).toBe(0);
    process.env.ADMIN_EMAILS = 'boss@x.com';
    expect(undoPlan(gameId, player(a.id))).toBe(0);
  });

  it('still allows undo inside an unfinished tournament game', () => {
    const { player: a } = createHumanWithSession('A');
    const b = createHuman('B');
    const { gameId } = knockout2(a.id, b, a.id);
    throwFor(gameId, a.id, ['T20', 'T20', 'T20']);
    expect(undoPlan(gameId, a)).toBe(1);
  });
});

// DR-H5: "Abandon" (DELETE /api/games/:id) on a tournament game left its match
// in_progress with no game → launchMatch 409 forever.
describe('DELETE /api/games/:id on tournament games', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp({ logger: false, rateLimit: false, helmet: false });
  });

  it('a participant cannot abandon a tournament game (409) and the match stays playable', async () => {
    const { player: a, token } = createHumanWithSession('A');
    const b = createHuman('B');
    const { tid, matchId, gameId } = knockout2(a.id, b, a.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}`, headers: bearer(token) });
    expect(res.statusCode).toBe(409);
    expect(launchMatch(tid, matchId)).toBe(gameId);
  });

  it('an admin delete restarts the match (ready again, relaunchable)', async () => {
    process.env.ADMIN_EMAILS = 'boss@x.com';
    const { player: boss, token } = createHumanWithSession('Boss', { email: 'boss@x.com', googleId: 'g_boss' });
    const { tid, matchId, gameId } = knockout2(boss.id, createHuman('B'), boss.id);
    const res = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}`, headers: bearer(token) });
    expect(res.statusCode).toBe(204);
    const m = db.prepare('SELECT game_id, status FROM tournament_matches WHERE id = ?').get(matchId);
    expect(m).toEqual({ game_id: null, status: 'ready' });
    const relaunched = launchMatch(tid, matchId);
    expect(relaunched).not.toBe(gameId);
  });

  it('ordinary games can still be abandoned', async () => {
    const { player: a, token } = createHumanWithSession('A');
    const gameId = createX01Game('501', [a.id, createHuman('B')]);
    const res = await app.inject({ method: 'DELETE', url: `/api/games/${gameId}`, headers: bearer(token) });
    expect(res.statusCode).toBe(204);
  });
});
