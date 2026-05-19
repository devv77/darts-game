import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../src/db.js';
import {
  createHuman,
  createStubIo,
  createX01Game,
  fullState,
  playTurn,
  resetDb,
} from './helpers.js';

/** All valid single-dart faces and their point values. */
const ALL_DARTS: { dart: string; value: number }[] = [
  { dart: '0', value: 0 },
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `S${i + 1}`, value: i + 1 })),
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `D${i + 1}`, value: 2 * (i + 1) })),
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `T${i + 1}`, value: 3 * (i + 1) })),
  { dart: 'SB', value: 25 },
  { dart: 'DB', value: 50 },
];

/** Find a 3-dart combo summing to exactly `target` (0 ≤ target ≤ 180). */
function pickDartsFor(target: number): string[] {
  if (target < 0 || target > 180) throw new Error(`Out of range: ${target}`);
  for (const a of ALL_DARTS) {
    for (const b of ALL_DARTS) {
      const need = target - a.value - b.value;
      if (need < 0) continue;
      const c = ALL_DARTS.find((d) => d.value === need);
      if (c) return [a.dart, b.dart, c.dart];
    }
  }
  throw new Error(`No 3-dart combo for ${target}`);
}

/**
 * Drive `victim` down to `target` score. Each turn drops up to 180 points;
 * the opponent passes with three misses. Stops when score equals target.
 */
function driveTo(gameId: number, victimId: number, target: number) {
  const { io } = createStubIo();
  while (true) {
    const state = fullState(gameId);
    const current = state.scores[victimId]!;
    if (current === target) return;
    const isVictim = state.players[state.current_player_index]!.id === victimId;
    if (!isVictim) {
      playTurn(io, gameId, ['0', '0', '0']);
      continue;
    }
    const drop = Math.min(current - target, 180);
    playTurn(io, gameId, pickDartsFor(drop));
  }
}

describe('X01 — game setup', () => {
  beforeEach(() => resetDb());

  it('starts both players at 501 with no turns logged', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b]);
    const s = fullState(gameId);
    expect(s.scores[a]).toBe(501);
    expect(s.scores[b]).toBe(501);
    expect(s.turns).toHaveLength(0);
    expect(s.current_player_index).toBe(0);
    expect(s.current_round).toBe(1);
  });

  it('starts both players at 301 in 301 mode', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    const s = fullState(gameId);
    expect(s.scores[a]).toBe(301);
    expect(s.scores[b]).toBe(301);
  });
});

describe('X01 — turn mechanics', () => {
  beforeEach(() => resetDb());

  it('decrements the active player score and alternates to next player', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['T20', 'T20', 'T20']); // 180
    let s = fullState(gameId);
    expect(s.scores[a]).toBe(321);
    expect(s.scores[b]).toBe(501);
    expect(s.turns[0]!.score_total).toBe(180);
    expect(s.current_player_index).toBe(1);

    playTurn(io, gameId, ['S20', 'S20', 'S20']); // 60
    s = fullState(gameId);
    expect(s.scores[a]).toBe(321);
    expect(s.scores[b]).toBe(441);
    expect(s.current_player_index).toBe(0);
  });

  it('records a 0/0/0 turn as a passed turn (no score change)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();
    playTurn(io, gameId, ['0', '0', '0']);
    const s = fullState(gameId);
    expect(s.scores[a]).toBe(501);
    expect(s.turns).toHaveLength(1);
    expect(s.turns[0]!.score_total).toBe(0);
    expect(s.turns[0]!.is_bust).toBe(0);
  });
});

describe('X01 — bust rules', () => {
  beforeEach(() => resetDb());

  it('busts when score would go below 0', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    driveTo(gameId, a, 50); // Alice at 50

    const { io } = createStubIo();
    let s = fullState(gameId);
    expect(s.scores[a]).toBe(50);
    // Make sure Alice is up. If not, pass Bob.
    while (s.players[s.current_player_index]!.id !== a) {
      playTurn(io, gameId, ['0', '0', '0']);
      s = fullState(gameId);
    }
    playTurn(io, gameId, ['T20', '0', '0']); // 60 > 50 → bust

    s = fullState(gameId);
    expect(s.scores[a]).toBe(50);
    const aliceTurns = s.turns.filter((t) => t.player_id === a);
    const last = aliceTurns[aliceTurns.length - 1]!;
    expect(last.is_bust).toBe(1);
    expect(last.score_total).toBe(0);
  });

  it('busts when ending on 1 (impossible double-out)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    driveTo(gameId, a, 3);

    const { io } = createStubIo();
    let s = fullState(gameId);
    while (s.players[s.current_player_index]!.id !== a) {
      playTurn(io, gameId, ['0', '0', '0']);
      s = fullState(gameId);
    }
    playTurn(io, gameId, ['S2', '0', '0']); // 3-2=1 → bust

    s = fullState(gameId);
    expect(s.scores[a]).toBe(3);
    const aliceTurns = s.turns.filter((t) => t.player_id === a);
    const last = aliceTurns[aliceTurns.length - 1]!;
    expect(last.is_bust).toBe(1);
  });

  it('busts when closing on a non-double', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    driveTo(gameId, a, 20);

    const { io } = createStubIo();
    let s = fullState(gameId);
    while (s.players[s.current_player_index]!.id !== a) {
      playTurn(io, gameId, ['0', '0', '0']);
      s = fullState(gameId);
    }
    playTurn(io, gameId, ['S20', '0', '0']); // 20 → 0 but last dart not a double → bust

    s = fullState(gameId);
    expect(s.scores[a]).toBe(20);
    expect(s.status).toBe('in_progress');
    const aliceTurns = s.turns.filter((t) => t.player_id === a);
    const last = aliceTurns[aliceTurns.length - 1]!;
    expect(last.is_bust).toBe(1);
  });
});

describe('X01 — checkout', () => {
  beforeEach(() => resetDb());

  it('wins on D20 checkout from 40', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    driveTo(gameId, a, 40);

    const { io } = createStubIo();
    let s = fullState(gameId);
    while (s.players[s.current_player_index]!.id !== a) {
      playTurn(io, gameId, ['0', '0', '0']);
      s = fullState(gameId);
    }
    playTurn(io, gameId, ['D20']); // checkout (last dart is the double)

    s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);
  });

  it('wins on the double bull (DB = 50)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b]);
    driveTo(gameId, a, 50);

    const { io } = createStubIo();
    let s = fullState(gameId);
    while (s.players[s.current_player_index]!.id !== a) {
      playTurn(io, gameId, ['0', '0', '0']);
      s = fullState(gameId);
    }
    playTurn(io, gameId, ['DB']);

    s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);
  });
});

describe('X01 — undo', () => {
  beforeEach(() => resetDb());

  it('undo restores the prior state', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['T20', 'T20', 'T20']);
    let s = fullState(gameId);
    expect(s.scores[a]).toBe(321);

    db.prepare('DELETE FROM turns WHERE id = ?').run(s.turns[s.turns.length - 1]!.id);

    s = fullState(gameId);
    expect(s.scores[a]).toBe(501);
    expect(s.turns).toHaveLength(0);
    expect(s.current_player_index).toBe(0);
  });
});

describe('X01 — best-of-N legs', () => {
  beforeEach(() => resetDb());

  it('first to 2 legs wins a best-of-3 match', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], { format: 'legs', bestOfLegs: 3 });

    const winLegForAlice = () => {
      driveTo(gameId, a, 40);
      const { io } = createStubIo();
      let s = fullState(gameId);
      while (s.players[s.current_player_index]!.id !== a) {
        playTurn(io, gameId, ['0', '0', '0']);
        s = fullState(gameId);
      }
      playTurn(io, gameId, ['D20']);
    };

    winLegForAlice();
    let s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(1);

    winLegForAlice();
    s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(2);
  });
});
