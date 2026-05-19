import { describe, it, expect, beforeEach } from 'vitest';
import { undoLastTurn } from '../src/socket-handler.js';
import {
  createCricketGame,
  createHuman,
  createStubIo,
  createX01Game,
  fullState,
  playTurn,
  resetDb,
} from './helpers.js';

describe('Cricket undo — bug coverage', () => {
  beforeEach(() => resetDb());

  it('undo removes points scored during the turn (not just the marks)', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', 'S20', 'S20']);
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['S20', 'S20', 'S20']); // 60 points

    let s = fullState(gameId);
    expect(s.cricket_state!.find((c) => c.player_id === a)!.points).toBe(60);

    undoLastTurn(gameId);
    s = fullState(gameId);
    const alice = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(alice.marks_20).toBe(3);
    expect(alice.points).toBe(0);
  });

  it('undo from a 4-marks-on-20 turn correctly rolls back marks and 1 mark of points', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createCricketGame([a, b]);
    const { io } = createStubIo();

    playTurn(io, gameId, ['S20', '0', '0']); // Alice: 1 mark
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['T20', '0', '0']); // Alice: 4 marks, 20 points (1 overflow)

    let s = fullState(gameId);
    expect(s.cricket_state!.find((c) => c.player_id === a)!.points).toBe(20);

    undoLastTurn(gameId);
    s = fullState(gameId);
    const alice = s.cricket_state!.find((c) => c.player_id === a)!;
    expect(alice.marks_20).toBe(1);
    expect(alice.points).toBe(0);
  });
});

describe('X01 undo — leg/set rebuild', () => {
  beforeEach(() => resetDb());

  it('undoing a leg-winning turn decrements legs_won', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b], { format: 'legs', bestOfLegs: 3 });
    const { io } = createStubIo();

    playTurn(io, gameId, ['T20', 'T20', 'T20']);
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['T20', 'S20', 'S1']); // -> 40
    playTurn(io, gameId, ['0', '0', '0']);
    playTurn(io, gameId, ['D20']); // checkout

    let s = fullState(gameId);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(1);
    expect(s.scores[a]).toBe(301); // new leg started

    undoLastTurn(gameId);
    s = fullState(gameId);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(0);
    expect(s.scores[a]).toBe(40);
  });

  it('undoing the match-winning leg restores in-progress state and rolls back legs_won', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b], { format: 'legs', bestOfLegs: 3 });
    const { io } = createStubIo();

    const winLegA = () => {
      while (true) {
        const s = fullState(gameId);
        if (s.status === 'completed') return;
        const isAlice = s.players[s.current_player_index]!.id === a;
        if (!isAlice) { playTurn(io, gameId, ['0', '0', '0']); continue; }
        if (s.scores[a] === 40) { playTurn(io, gameId, ['D20']); return; }
        const drop = s.scores[a]! - 40;
        if (drop >= 180) playTurn(io, gameId, ['T20', 'T20', 'T20']);
        else playTurn(io, gameId, ['T20', 'S20', 'S1']); // 81 → 40
      }
    };

    winLegA(); winLegA(); // 2 legs → match over (best of 3, first to 2)
    let s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(s.winner_id).toBe(a);

    undoLastTurn(gameId);
    s = fullState(gameId);
    expect(s.status).toBe('in_progress');
    expect(s.winner_id).toBeNull();
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(1);
    expect(s.scores[a]).toBe(40);
  });

  it('undoing the set-winning leg of a sets match rebuilds legs/sets correctly', () => {
    const a = createHuman('Alice');
    const b = createHuman('Bob');
    const gameId = createX01Game('301', [a, b], { format: 'sets', bestOfSets: 3, bestOfLegsPerSet: 3 });
    const { io } = createStubIo();

    const winLegAlice = () => {
      while (true) {
        const s = fullState(gameId);
        if (s.status === 'completed') return;
        const isAlice = s.players[s.current_player_index]!.id === a;
        if (!isAlice) { playTurn(io, gameId, ['0', '0', '0']); continue; }
        if (s.scores[a] === 40) { playTurn(io, gameId, ['D20']); return; }
        const drop = s.scores[a]! - 40;
        if (drop >= 180) playTurn(io, gameId, ['T20', 'T20', 'T20']);
        else playTurn(io, gameId, ['T20', 'S20', 'S1']);
      }
    };

    winLegAlice();
    winLegAlice(); // set 1 to Alice
    let s = fullState(gameId);
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(1);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(0);

    undoLastTurn(gameId);
    s = fullState(gameId);
    expect(s.players.find((p) => p.id === a)!.sets_won).toBe(0);
    expect(s.players.find((p) => p.id === a)!.legs_won).toBe(1);
    expect(s.scores[a]).toBe(40);
  });
});
