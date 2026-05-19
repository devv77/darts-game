import { describe, it, expect, beforeEach } from 'vitest';
import {
  createHuman,
  createStubIo,
  createX01Game,
  fullState,
  playTurn,
  resetDb,
} from './helpers.js';

/**
 * Drive `victim` to `target` in the current leg. Opponent passes with 0/0/0.
 * Used to set up a checkout shot for the winning dart.
 */
function driveTo(gameId: number, victimId: number, target: number) {
  const { io } = createStubIo();
  while (true) {
    const state = fullState(gameId);
    if (state.status === 'completed') return;
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

const ALL_DARTS = [
  { dart: '0', value: 0 },
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `S${i + 1}`, value: i + 1 })),
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `D${i + 1}`, value: 2 * (i + 1) })),
  ...Array.from({ length: 20 }, (_, i) => ({ dart: `T${i + 1}`, value: 3 * (i + 1) })),
  { dart: 'SB', value: 25 },
  { dart: 'DB', value: 50 },
];

function pickDartsFor(target: number): string[] {
  if (target === 0) return ['0', '0', '0'];
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

/** Have `winnerId` check out from 40 with D20, regardless of current turn order. */
function winLegFor(gameId: number, winnerId: number) {
  driveTo(gameId, winnerId, 40);
  const { io } = createStubIo();
  let s = fullState(gameId);
  while (s.players[s.current_player_index]!.id !== winnerId && s.status === 'in_progress') {
    playTurn(io, gameId, ['0', '0', '0']);
    s = fullState(gameId);
  }
  if (s.status !== 'in_progress') return;
  playTurn(io, gameId, ['D20']);
}

describe('Sets format — leg transitions within a set', () => {
  beforeEach(() => resetDb());

  it('after winning a leg, scores reset and legs_won increments for the winner only', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    winLegFor(gameId, a);

    const s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.scores[a]).toBe(501);
    expect(s.scores[b]).toBe(501);
    expect(s.current_leg).toBe(2);
    expect(s.current_set).toBe(1);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(1);
    expect(s.players.find((p) => p.id === b)!.legs_won).toBe(0);
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(0);
  });

  it('best-of-3 legs-per-set: winning 2 legs in a row takes the set, legs reset for both', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    winLegFor(gameId, a);
    winLegFor(gameId, a);

    const s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(1);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(0);
    expect(s.players.find((p) => p.id === b)!.legs_won).toBe(0);
    expect(s.current_set).toBe(2);
    expect(s.current_leg).toBe(1);
    expect(s.scores[a]).toBe(501);
    expect(s.scores[b]).toBe(501);
  });
});

describe('Sets format — match completion', () => {
  beforeEach(() => resetDb());

  it('first to win bestOfSets/2 sets wins the match', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    // Set 1: Alice wins 2-0
    winLegFor(gameId, a);
    winLegFor(gameId, a);

    let s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(1);

    // Set 2: Alice wins 2-0 → match over
    winLegFor(gameId, a);
    winLegFor(gameId, a);

    s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(2);
  });

  it('split sets advance correctly: 1-1 in sets, then decider', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    // Set 1: Alice 2-0
    winLegFor(gameId, a);
    winLegFor(gameId, a);
    // Set 2: Bob 2-0
    winLegFor(gameId, b);
    winLegFor(gameId, b);

    let s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(1);
    expect(s.players.find((p) => p.id === b)!.sets_won).toBe(1);
    expect(s.current_set).toBe(3);
    expect(s.current_leg).toBe(1);

    // Decider: Bob 2-0
    winLegFor(gameId, b);
    winLegFor(gameId, b);

    s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(b);
  });
});

describe('Sets format — leg starting player', () => {
  beforeEach(() => resetDb());

  it('the player who did not start leg 1 starts leg 2 (alternation)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    // Confirm Alice starts leg 1.
    let s = fullState(gameId);
    expect(s.players[s.current_player_index]!.id).toBe(a);

    winLegFor(gameId, a);
    s = fullState(gameId);
    expect(s.players[s.current_player_index]!.id).toBe(b);
  });
});

describe('Sets format — within-set scores reset cleanly', () => {
  beforeEach(() => resetDb());

  it('after a set win, current_leg=1 and previous-set turns do not leak into score', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('501', [a, b], {
      format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3,
    });

    winLegFor(gameId, a);
    winLegFor(gameId, a);

    // Throw a turn in set 2, leg 1 and verify it's tagged correctly.
    const { io } = createStubIo();
    playTurn(io, gameId, ['T20', 'T20', 'T20']);
    const s = fullState(gameId);
    const lastTurn = s.turns[s.turns.length - 1]!;
    expect(lastTurn.set_num).toBe(2);
    expect(lastTurn.leg_num).toBe(1);
    // The new turn should have decremented exactly one player's score.
    const aScore = s.scores[a]!;
    const bScore = s.scores[b]!;
    expect(aScore + bScore).toBe(501 + 501 - 180);
  });
});
