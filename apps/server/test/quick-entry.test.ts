import { describe, it, expect, beforeEach } from 'vitest';
import { handleX01Turn, validateSubmitTurn } from '../src/socket-handler.js';
import { createHuman, createX01Game, fullState, createStubIo, resetDb } from './helpers.js';
import { db } from '../src/db.js';
import type { Turn } from '../src/types.js';

beforeEach(() => resetDb());

function lastTurn(gameId: number): Turn {
  return db.prepare('SELECT * FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1').get(gameId) as Turn;
}
function quick(io: ReturnType<typeof createStubIo>['io'], gameId: number, playerId: number, total: number) {
  const st = fullState(gameId);
  handleX01Turn(io, gameId, playerId, [], total, st.current_round, st);
}

describe('validateSubmitTurn — quick (numpad) entry must carry scoreTotal', () => {
  it('keeps a valid scoreTotal alongside empty darts', () => {
    expect(validateSubmitTurn({ gameId: 1, playerId: 2, darts: [], scoreTotal: 48 }, 2))
      .toEqual({ gameId: 1, playerId: 2, darts: [], scoreTotal: 48 });
  });

  it('rejects an out-of-range scoreTotal', () => {
    expect(validateSubmitTurn({ gameId: 1, playerId: 2, darts: [], scoreTotal: 200 }, 2)).toBeNull();
    expect(validateSubmitTurn({ gameId: 1, playerId: 2, darts: [], scoreTotal: -1 }, 2)).toBeNull();
    expect(validateSubmitTurn({ gameId: 1, playerId: 2, darts: [], scoreTotal: 1.5 }, 2)).toBeNull();
  });

  it('defaults scoreTotal to null when darts are present (server recomputes)', () => {
    expect(validateSubmitTurn({ gameId: 1, playerId: 2, darts: ['T20'] }, 2))
      .toEqual({ gameId: 1, playerId: 2, darts: ['T20'], scoreTotal: null });
  });
});

describe('handleX01Turn — quick entry scores instead of phantom-busting', () => {
  it('a 48 numpad throw from 501 deducts 48 and is NOT a bust', () => {
    const a = createHuman('A');
    const b = createHuman('B');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();
    quick(io, gameId, a, 48);
    const t = lastTurn(gameId);
    expect(t.is_bust).toBe(0);
    expect(t.score_total).toBe(48);
    expect(fullState(gameId).scores[a]).toBe(453);
  });

  it('a string-coerced scoreTotal still scores (client may send a string)', () => {
    const a = createHuman('A');
    const b = createHuman('B');
    const gameId = createX01Game('501', [a, b]);
    const v = validateSubmitTurn({ gameId, playerId: a, darts: [], scoreTotal: '60' }, a);
    expect(v).not.toBeNull();
    expect(v!.scoreTotal).toBe(60);
  });

  it('quick entry still cannot check out — reaching exactly 0 without darts busts', () => {
    const a = createHuman('A');
    const b = createHuman('B');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();
    quick(io, gameId, a, 180); // 321
    quick(io, gameId, a, 180); // 141
    quick(io, gameId, a, 91);  // 50
    expect(fullState(gameId).scores[a]).toBe(50);
    quick(io, gameId, a, 50);  // would hit 0 with no darts → bust
    const t = lastTurn(gameId);
    expect(t.is_bust).toBe(1);
    expect(fullState(gameId).scores[a]).toBe(50); // unchanged — bust didn't score
  });

  it('overshooting (score > remaining) busts and leaves the score unchanged', () => {
    const a = createHuman('A');
    const b = createHuman('B');
    const gameId = createX01Game('501', [a, b]);
    const { io } = createStubIo();
    quick(io, gameId, a, 180); // 321
    quick(io, gameId, a, 180); // 141
    quick(io, gameId, a, 100); // 41
    expect(fullState(gameId).scores[a]).toBe(41);
    quick(io, gameId, a, 60);  // 41 - 60 < 0 → bust
    expect(lastTurn(gameId).is_bust).toBe(1);
    expect(fullState(gameId).scores[a]).toBe(41);
  });
});
