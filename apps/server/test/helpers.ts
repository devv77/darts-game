import type { Server as SocketIOServer } from 'socket.io';
import { db } from '../src/db.js';
import { createSession } from '../src/auth.js';
import { getFullGameState } from '../src/game-state.js';
import { generateAiTurn } from '../src/ai-engine.js';
import { handleX01Turn, handleCricketTurn } from '../src/socket-handler.js';
import type { FullGameState, GameMode, MatchSettings, Player } from '../src/types.js';

export function createHumanWithSession(name: string, opts: { email?: string; googleId?: string } = {}): { player: Player; token: string } {
  const result = db.prepare(
    'INSERT INTO players (name, avatar_color, is_ai, ai_level, email, google_id) VALUES (?, ?, 0, NULL, ?, ?)'
  ).run(name, '#3b82f6', opts.email ?? null, opts.googleId ?? null);
  const id = result.lastInsertRowid as number;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(id) as Player;
  const { token } = createSession(player.id);
  return { player, token };
}

export function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

export interface EmitRecord { room: string; event: string; payload: unknown }

export function createStubIo(): { io: SocketIOServer; emits: EmitRecord[] } {
  const emits: EmitRecord[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => {
        emits.push({ room, event, payload });
      },
    }),
  } as unknown as SocketIOServer;
  return { io, emits };
}

export function resetDb(): void {
  db.transaction(() => {
    db.exec('DELETE FROM sessions');
    db.exec('DELETE FROM cricket_state');
    db.exec('DELETE FROM turns');
    db.exec('DELETE FROM game_players');
    db.exec('DELETE FROM games');
    db.exec('DELETE FROM players WHERE is_ai = 0');
  })();
}

export function createHuman(name: string, color = '#3b82f6'): number {
  const result = db.prepare(
    'INSERT INTO players (name, avatar_color, is_ai, ai_level) VALUES (?, ?, 0, NULL)'
  ).run(name, color);
  return result.lastInsertRowid as number;
}

export function getAi(level: number): Player {
  const ai = db.prepare('SELECT * FROM players WHERE is_ai = 1 AND ai_level = ?').get(level) as Player | undefined;
  if (!ai) throw new Error(`No AI player at level ${level}`);
  return ai;
}

export function createX01Game(mode: '501' | '301', playerIds: number[], settings: MatchSettings = { format: 'single' }): number {
  const txn = db.transaction(() => {
    const r = db.prepare('INSERT INTO games (mode, settings) VALUES (?, ?)').run(mode, JSON.stringify(settings));
    const gameId = r.lastInsertRowid as number;
    const insertGp = db.prepare('INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)');
    playerIds.forEach((pid, i) => insertGp.run(gameId, pid, i));
    return gameId;
  });
  return txn();
}

export function createCricketGame(playerIds: number[]): number {
  const txn = db.transaction(() => {
    const r = db.prepare('INSERT INTO games (mode, settings) VALUES (?, ?)').run('cricket', '{}');
    const gameId = r.lastInsertRowid as number;
    const insertGp = db.prepare('INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)');
    const insertCs = db.prepare('INSERT INTO cricket_state (game_id, player_id) VALUES (?, ?)');
    playerIds.forEach((pid, i) => {
      insertGp.run(gameId, pid, i);
      insertCs.run(gameId, pid);
    });
    return gameId;
  });
  return txn();
}

export function fullState(gameId: number): FullGameState {
  const s = getFullGameState(gameId);
  if (!s) throw new Error(`Game ${gameId} not found`);
  return s;
}

export function playTurn(io: SocketIOServer, gameId: number, darts: string[]): void {
  const state = fullState(gameId);
  const player = state.players[state.current_player_index]!;
  if (state.mode === 'cricket') {
    handleCricketTurn(io, gameId, player.id, darts, state.current_round, state);
  } else {
    handleX01Turn(io, gameId, player.id, darts, null, state.current_round, state);
  }
}

/**
 * Drive a full game to completion using the AI engine for every player.
 * Returns the round count when it ended; throws if maxRounds is exceeded.
 */
export function playOutWithAi(io: SocketIOServer, gameId: number, maxRounds = 500): number {
  let rounds = 0;
  while (rounds < maxRounds) {
    const state = fullState(gameId);
    if (state.status === 'completed') return rounds;
    const player = state.players[state.current_player_index]!;
    const aiLevel = player.is_ai ? player.ai_level! : 10;
    const mode: GameMode = state.mode;
    const result = generateAiTurn(aiLevel, mode, state, player.id);
    if (mode === 'cricket') {
      handleCricketTurn(io, gameId, player.id, result.darts, state.current_round, state);
    } else {
      handleX01Turn(io, gameId, player.id, result.darts, null, state.current_round, state);
    }
    rounds++;
  }
  throw new Error(`Game ${gameId} did not complete within ${maxRounds} rounds`);
}
