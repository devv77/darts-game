import { describe, it, expect, beforeEach } from 'vitest';
import type { Server as SocketIOServer } from 'socket.io';
import {
  createHuman,
  createStubIo,
  createAtcGame,
  createX01Game,
  fullState,
  getAi,
  playTurn,
  playOutWithAi,
  resetDb,
} from './helpers.js';

function atc(gameId: number, playerId: number) {
  const a = fullState(gameId).atc_state?.find((s) => s.player_id === playerId);
  if (!a) throw new Error('no atc_state');
  return a;
}

/** Advance the sole player of a solo ATC game to `toHits` cleared targets. */
function advanceSolo(io: SocketIOServer, gameId: number, toHits: number) {
  const pid = fullState(gameId).players[0]!.id;
  let guard = 0;
  while (guard++ < 60) {
    const a = atc(gameId, pid);
    if (a.hits >= toHits || a.completed) return;
    const darts: string[] = [];
    let h = a.hits;
    while (darts.length < 3 && h < toHits) {
      if (h < 20) { darts.push('S' + (h + 1)); h++; }
      else { darts.push('SB'); h = 21; }
    }
    playTurn(io, gameId, darts);
  }
  throw new Error('advanceSolo did not reach target');
}

describe('ATC — setup & progress', () => {
  beforeEach(() => resetDb());

  it('starts every player on target 1 with nothing cleared', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createAtcGame([a, b]);
    const state = fullState(gameId);
    expect(state.mode).toBe('atc');
    expect(state.current_player_index).toBe(0);
    for (const pid of [a, b]) {
      expect(atc(gameId, pid)).toMatchObject({ hits: 0, target: 1, completed: false });
    }
  });

  it('exact single of the current number advances by one', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io } = createStubIo();
    playTurn(io, gameId, ['S1']);
    expect(atc(gameId, a)).toMatchObject({ hits: 1, target: 2 });
  });

  it('doubles/trebles of the number do NOT advance in single mode', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a], { atcAdvance: 'single' });
    const { io } = createStubIo();
    playTurn(io, gameId, ['D1', 'T1']);
    expect(atc(gameId, a).hits).toBe(0);
    // …but a plain single still counts, even after the wasted D/T darts.
    playTurn(io, gameId, ['S1']);
    expect(atc(gameId, a).hits).toBe(1);
  });

  it('a wrong number never advances', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io } = createStubIo();
    playTurn(io, gameId, ['S5', 'S20', 'S2']);
    expect(atc(gameId, a).hits).toBe(0);
  });

  it('advances up to three targets in a single turn', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io } = createStubIo();
    playTurn(io, gameId, ['S1', 'S2', 'S3']);
    expect(atc(gameId, a)).toMatchObject({ hits: 3, target: 4 });
  });

  it('rotates turns cricket-style between players', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createAtcGame([a, b]);
    const { io } = createStubIo();
    expect(fullState(gameId).current_player_index).toBe(0);
    playTurn(io, gameId, ['S1']);
    expect(fullState(gameId).current_player_index).toBe(1);
  });
});

describe('ATC — multiplier (skip) mode', () => {
  beforeEach(() => resetDb());

  it('double = +2, treble = +3 on the current number', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a], { atcAdvance: 'multiplier' });
    const { io } = createStubIo();
    playTurn(io, gameId, ['D1']); // on 1 → +2
    expect(atc(gameId, a).hits).toBe(2); // now on target 3
    playTurn(io, gameId, ['T3']); // on 3 → +3
    expect(atc(gameId, a).hits).toBe(5);
  });

  it('a treble can leapfrog to finish, capped at 21', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a], { atcAdvance: 'multiplier' });
    const { io } = createStubIo();
    advanceSolo(io, gameId, 19); // on target 20
    expect(atc(gameId, a).target).toBe(20);
    playTurn(io, gameId, ['T20']); // 19 + 3 = 22 → capped 21 = win
    const state = fullState(gameId);
    expect(atc(gameId, a).completed).toBe(true);
    expect(state.status).toBe('completed');
    expect(state.winner_id).toBe(a);
  });
});

describe('ATC — winning on the bull', () => {
  beforeEach(() => resetDb());

  it('clearing 1→20 then the bull wins, and emits game-over', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io, emits } = createStubIo();
    advanceSolo(io, gameId, 20); // all 20 numbers → target is now the bull
    expect(atc(gameId, a).target).toBe(21);
    expect(fullState(gameId).status).toBe('in_progress');
    playTurn(io, gameId, ['SB']);
    const state = fullState(gameId);
    expect(state.status).toBe('completed');
    expect(state.winner_id).toBe(a);
    expect(emits.some((e) => e.event === 'game-over')).toBe(true);
  });

  it('a double bull also finishes the bull', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io } = createStubIo();
    advanceSolo(io, gameId, 20);
    playTurn(io, gameId, ['DB']);
    expect(fullState(gameId).status).toBe('completed');
  });

  it('being on the bull, missing it does not win', () => {
    const a = createHuman('Alice');
    const gameId = createAtcGame([a]);
    const { io } = createStubIo();
    advanceSolo(io, gameId, 20);
    playTurn(io, gameId, ['S20', 'T19', '0']);
    expect(fullState(gameId).status).toBe('in_progress');
    expect(atc(gameId, a).hits).toBe(20);
  });
});

describe('ATC — AI', () => {
  beforeEach(() => resetDb());

  it('a World Class AI completes a solo ATC game (single mode)', () => {
    const ai = getAi(10);
    const gameId = createAtcGame([ai.id], { atcAdvance: 'single' });
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 400);
    expect(fullState(gameId).status).toBe('completed');
  });

  it('AI completes a solo ATC game in multiplier mode', () => {
    const ai = getAi(9);
    const gameId = createAtcGame([ai.id], { atcAdvance: 'multiplier' });
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 400);
    expect(fullState(gameId).status).toBe('completed');
  });
});

describe('X01 — checkout out-mode', () => {
  beforeEach(() => resetDb());

  it('single-out: finishing on a single wins (no double needed)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b], { format: 'single', outMode: 'single' });
    const { io } = createStubIo();
    // Alice: 301 → 5 (T20 T20 …), simplest: drop to 5 across turns via 20s then finish S5.
    // Reduce with three T20 = 180, then get to a single-out finish.
    playTurn(io, gameId, ['T20', 'T20', 'T20']); // 301 → 121
    playTurn(io, gameId, ['0', '0', '0']);       // Bob passes
    playTurn(io, gameId, ['T20', 'T20', 'S1']);  // 121 → 121-120-... = 0? 60+60+1=121 → win on S1
    const state = fullState(gameId);
    expect(state.status).toBe('completed');
    expect(state.winner_id).toBe(a);
  });

  it('double-out (default): landing on 0 with a single busts', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b], { format: 'single' });
    const { io } = createStubIo();
    playTurn(io, gameId, ['T20', 'T20', 'T20']); // 301 → 121
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['T20', 'T20', 'S1']);  // reaches 0 on a single → BUST, not a win
    const state = fullState(gameId);
    expect(state.status).toBe('in_progress');
    // Busted turn scores nothing, so Alice is still on 121.
    expect(state.scores[a]).toBe(121);
  });
});
