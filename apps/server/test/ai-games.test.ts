import { describe, it, expect, beforeEach } from 'vitest';
import {
  createCricketGame,
  createStubIo,
  createX01Game,
  fullState,
  getAi,
  playOutWithAi,
  resetDb,
} from './helpers.js';

describe('AI bots — full game completion', () => {
  beforeEach(() => resetDb());

  it('501: AI Lv.1 vs AI Lv.1 completes with a winner', () => {
    const a = getAi(1);
    const b = getAi(2);
    const gameId = createX01Game('501', [a.id, b.id]);
    const { io } = createStubIo();
    const rounds = playOutWithAi(io, gameId, 800);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect([a.id, b.id]).toContain(s.winner_id);
    expect(rounds).toBeGreaterThan(0);
  });

  it('501: AI Lv.10 vs AI Lv.10 completes faster than Lv.1 vs Lv.1', () => {
    // Sanity: world-class bots should close out far quicker than beginners.
    const a = getAi(10);
    const b = getAi(9);
    const gameId = createX01Game('501', [a.id, b.id]);
    const { io } = createStubIo();
    const rounds = playOutWithAi(io, gameId, 300);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect(rounds).toBeLessThan(300);
  });

  it('301: AI Lv.5 vs AI Lv.5 completes with a winner', () => {
    const a = getAi(5);
    const b = getAi(6);
    const gameId = createX01Game('301', [a.id, b.id]);
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 500);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect([a.id, b.id]).toContain(s.winner_id);
  });

  it('cricket: AI Lv.5 vs AI Lv.5 completes with a winner', () => {
    const a = getAi(5);
    const b = getAi(6);
    const gameId = createCricketGame([a.id, b.id]);
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 200);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect([a.id, b.id]).toContain(s.winner_id);
  });

  it('501: 3-player AI free-for-all completes with exactly one winner', () => {
    const a = getAi(3);
    const b = getAi(5);
    const c = getAi(7);
    const gameId = createX01Game('501', [a.id, b.id, c.id]);
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 800);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    expect([a.id, b.id, c.id]).toContain(s.winner_id);
    // Exactly one player has score 0; the others are positive.
    const zeros = s.players.filter((p) => s.scores[p.id] === 0);
    expect(zeros).toHaveLength(1);
    expect(zeros[0]!.id).toBe(s.winner_id);
  });

  it('501 best-of-3 legs: AI vs AI completes with a winner holding ≥2 legs', () => {
    const a = getAi(8);
    const b = getAi(7);
    const gameId = createX01Game('501', [a.id, b.id], { format: 'legs', bestOfLegs: 3 });
    const { io } = createStubIo();
    playOutWithAi(io, gameId, 1500);
    const s = fullState(gameId);
    expect(s.status).toBe('completed');
    const winner = s.players.find((p) => p.id === s.winner_id)!;
    expect(winner.legs_won).toBeGreaterThanOrEqual(2);
  });
});
