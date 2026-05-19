import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCricketGame,
  createHuman,
  createStubIo,
  fullState,
  playTurn,
  resetDb,
} from './helpers.js';

describe('Cricket — game setup', () => {
  beforeEach(() => resetDb());

  it('starts with all marks at 0 and 0 points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const s = fullState(gameId);
    expect(s.mode).toBe('cricket');
    expect(s.cricket_state).toHaveLength(2);
    for (const cs of s.cricket_state!) {
      expect(cs.marks_15).toBe(0);
      expect(cs.marks_20).toBe(0);
      expect(cs.marks_bull).toBe(0);
      expect(cs.points).toBe(0);
    }
  });
});

describe('Cricket — marks & scoring', () => {
  beforeEach(() => resetDb());

  it('three singles on 20 closes the number with no points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', 'S20', 'S20']);
    const s = fullState(gameId);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_20).toBe(3);
    expect(aliceCricket.points).toBe(0);
  });

  it('treble on a fresh number closes it with no points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['T19', '0', '0']);
    const s = fullState(gameId);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_19).toBe(3);
    expect(aliceCricket.points).toBe(0);
  });

  it('scoring on a closed-but-not-by-opponents number adds points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    // Alice closes 20.
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice: marks 3, points 0
    // Bob throws away (not 20).
    playTurn(io, gameId, ['S5', 'S5', 'S5']);    // Bob doesn't touch 20
    // Alice throws three more 20s (each scores 20).
    playTurn(io, gameId, ['S20', 'S20', 'S20']);

    const s = fullState(gameId);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_20).toBe(6);
    expect(aliceCricket.points).toBe(60); // 3 singles × 20 = 60
  });

  it('does not score on a number all opponents have also closed', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice closes 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Bob closes 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice — both closed, no points
    const s = fullState(gameId);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_20).toBe(6);
    expect(aliceCricket.points).toBe(0);
  });

  it('partial close + treble counts overflow marks as points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', '0', '0']); // Alice 1 mark on 20
    playTurn(io, gameId, ['0', '0', '0']);   // Bob pass
    playTurn(io, gameId, ['T20', '0', '0']); // Alice 1+3=4 marks → 1 overflow → 20 points

    const s = fullState(gameId);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_20).toBe(4);
    expect(aliceCricket.points).toBe(20);
  });
});

describe('Cricket — 3+ players', () => {
  beforeEach(() => resetDb());

  it('scoring on a number closed by one opponent (but not all) still earns points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const c = createHuman('Carol');
    const gameId = createCricketGame([a, b, c]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice closes 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Bob closes 20
    playTurn(io, gameId, ['0', '0', '0']);        // Carol doesn't touch 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice scores 60 on 20 (Carol still open)

    const s = fullState(gameId);
    const alice = s.cricket_state!.find((cs) => cs.player_id === a)!;
    expect(alice.points).toBe(60);
  });

  it('scoring is blocked only when ALL opponents have closed the number', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const c = createHuman('Carol');
    const gameId = createCricketGame([a, b, c]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice closes 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Bob closes 20
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Carol closes 20 → all opponents closed for Alice
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // Alice — no points; 20 is dead

    const s = fullState(gameId);
    const alice = s.cricket_state!.find((cs) => cs.player_id === a)!;
    expect(alice.marks_20).toBe(6);
    expect(alice.points).toBe(0);
  });
});

describe('Cricket — winning', () => {
  beforeEach(() => resetDb());

  it('wins when all numbers closed and points lead (or tie) opponent', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    // Alice trebles every number → all closed with 0 points (since Bob hasn't closed).
    // Wait: hitting a treble on a fresh number closes it but doesn't score (only overflow scores).
    // So 7 numbers × T = 7 turns of 1 dart each won't work because turn count needs to fit.
    // Use full 3-dart turns: T20 T19 T18, T17 T16 T15, T_bull (T bull doesn't exist — use D bull).
    // Bull closes in 3 marks. D bull = 2 marks, S bull = 1 mark.

    playTurn(io, gameId, ['T20', 'T19', 'T18']); // closes 20, 19, 18
    playTurn(io, gameId, ['0', '0', '0']);        // Bob pass
    playTurn(io, gameId, ['T17', 'T16', 'T15']); // closes 17, 16, 15
    playTurn(io, gameId, ['0', '0', '0']);
    // Bull needs 3 marks. DB = 2 + SB = 1.
    playTurn(io, gameId, ['DB', 'SB', '0']);     // closes bull (2+1=3 marks)

    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(aliceCricket.marks_15).toBeGreaterThanOrEqual(3);
    expect(aliceCricket.marks_bull).toBeGreaterThanOrEqual(3);
  });

  it('does not win when all closed but trailing in points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    // Bob opens with a partial-close on 20 then scores.
    playTurn(io, gameId, ['0', '0', '0']);       // Alice pass
    playTurn(io, gameId, ['T20', 'S20', 'S20']); // Bob: 5 marks → 2 overflow → 40 pts, closes 20

    // Alice closes everything but can't out-point Bob without scoring on closed numbers.
    playTurn(io, gameId, ['T19', 'T18', 'T17']);
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['T16', 'T15', '0']);
    playTurn(io, gameId, ['0', '0', '0']);
    // Now Alice needs to close 20 + bull. Bob already closed 20, so any 20-marks beyond 3 won't score.
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // closes 20 (no points — Bob also closed)
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['DB', 'SB', '0']);     // closes bull

    const s = fullState(gameId);
    // All Alice's numbers are closed, but Bob leads in points → game continues.
    expect(s.status).toBe('in_progress');
    const aliceCricket = s.cricket_state!.find((c) => c.player_id === a)!;
    const bobCricket = s.cricket_state!.find((c) => c.player_id === b)!;
    expect(aliceCricket.points).toBeLessThan(bobCricket.points);
  });
});
