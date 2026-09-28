import { describe, it, expect, beforeEach } from 'vitest';
import { handleX01Turn, scoreX01Visit } from '../src/socket-handler.js';
import { createHuman, createX01Game, fullState, createStubIo, resetDb } from './helpers.js';
import { db } from '../src/db.js';
import type { Turn } from '../src/types.js';

beforeEach(() => resetDb());

// DR-H6: the visit ends at the first dart that finishes or busts; darts entered
// after it (a habitual "Miss" after D20) used to be scored and bust the checkout.
describe('scoreX01Visit', () => {
  it('double-out: stops at the finishing double', () => {
    expect(scoreX01Visit(40, ['D20', '0'], false)).toEqual({ thrown: ['D20'], turnScore: 40, isBust: false });
    expect(scoreX01Visit(60, ['S20', 'D20', '0'], false)).toEqual({ thrown: ['S20', 'D20'], turnScore: 60, isBust: false });
    expect(scoreX01Visit(20, ['D10', 'S5'], false)).toEqual({ thrown: ['D10'], turnScore: 20, isBust: false });
    expect(scoreX01Visit(50, ['DB', 'T20'], false)).toEqual({ thrown: ['DB'], turnScore: 50, isBust: false });
  });

  it('double-out: busts at the dart that goes below 0, leaves 1, or finishes off a non-double', () => {
    expect(scoreX01Visit(40, ['S20', 'S20', 'D5'], false)).toEqual({ thrown: ['S20', 'S20'], turnScore: 0, isBust: true });
    expect(scoreX01Visit(41, ['S20', 'S20', 'D1'], false)).toEqual({ thrown: ['S20', 'S20'], turnScore: 0, isBust: true });
    expect(scoreX01Visit(32, ['T20', 'D16'], false)).toEqual({ thrown: ['T20'], turnScore: 0, isBust: true });
  });

  it('single-out: any dart reaching 0 finishes; leaving 1 is legal', () => {
    expect(scoreX01Visit(60, ['T20', 'S5'], true)).toEqual({ thrown: ['T20'], turnScore: 60, isBust: false });
    expect(scoreX01Visit(21, ['S20'], true)).toEqual({ thrown: ['S20'], turnScore: 20, isBust: false });
    expect(scoreX01Visit(20, ['T20'], true)).toEqual({ thrown: ['T20'], turnScore: 0, isBust: true });
  });

  it('an ordinary visit scores all three darts', () => {
    expect(scoreX01Visit(501, ['T20', 'T20', 'T20'], false)).toEqual({ thrown: ['T20', 'T20', 'T20'], turnScore: 180, isBust: false });
  });
});

describe('handleX01Turn with darts after the finish', () => {
  it('D20 then Miss from 40 checks out and records only the finishing dart', () => {
    const a = createHuman('A');
    const b = createHuman('B');
    const gameId = createX01Game('301', [a, b]);
    const { io } = createStubIo();
    const turn = (p: number, d: string[]) => { const st = fullState(gameId); handleX01Turn(io, gameId, p, d, null, st.current_round, st); };
    turn(a, ['T20', 'T20', 'T20']); // 121
    turn(b, ['0', '0', '0']);
    turn(a, ['T20', 'S1', '0']);    // 60
    turn(b, ['0', '0', '0']);
    turn(a, ['S20', 'D20', '0']);
    const t = db.prepare('SELECT * FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gameId) as Turn;
    expect(t.is_bust).toBe(0);
    expect(t.score_total).toBe(60);
    expect([t.dart1, t.dart2, t.dart3]).toEqual(['S20', 'D20', null]);
    const g = db.prepare('SELECT status, winner_id FROM games WHERE id = ?').get(gameId) as { status: string; winner_id: number };
    expect(g).toEqual({ status: 'completed', winner_id: a });
  });
});
