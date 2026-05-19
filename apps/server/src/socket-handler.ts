import type { Server as SocketIOServer } from 'socket.io';
import { db } from './db.js';
import { lookupSession } from './auth.js';
import { getFullGameState } from './game-state.js';
import { generateAiTurn } from './ai-engine.js';
import { parseDartScore, parseCricketDart } from './darts.js';
import type { FullGameState, Game, MatchSettings, Player } from './types.js';

const aiTurnInProgress = new Set<number | string>();

export function setupSocket(io: SocketIOServer) {
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined)
      ?? (typeof socket.handshake.headers.authorization === 'string'
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);
    const player = lookupSession(token);
    if (!player) {
      next(new Error('Authentication required'));
      return;
    }
    (socket.data as { player: Player }).player = player;
    next();
  });

  io.on('connection', (socket) => {
    socket.on('join-game', ({ gameId }: { gameId: number }) => {
      socket.join(`game:${gameId}`);
      const state = getFullGameState(gameId);
      if (state) {
        socket.emit('game-state', state);
        checkAndTriggerAiTurn(io, gameId);
      }
    });

    socket.on('submit-turn', ({ gameId, playerId, darts, scoreTotal }: {
      gameId: number; playerId: number; darts?: string[]; scoreTotal?: number;
    }) => {
      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
      if (!game || game.status !== 'in_progress') return;

      const state = getFullGameState(gameId);
      if (!state) return;
      const roundNum = state.current_round;

      if (game.mode === '501' || game.mode === '301') {
        handleX01Turn(io, gameId, playerId, darts ?? [], scoreTotal ?? null, roundNum, state);
      } else if (game.mode === 'cricket') {
        handleCricketTurn(io, gameId, playerId, darts ?? [], roundNum, state);
      }
    });

    socket.on('undo-turn', ({ gameId }: { gameId: number }) => {
      undoLastTurn(gameId);
      const newState = getFullGameState(gameId);
      io.to(`game:${gameId}`).emit('game-state', newState);
    });
  });
}

export function handleX01Turn(
  io: SocketIOServer,
  gameId: number,
  playerId: number,
  darts: string[],
  scoreTotal: number | null,
  roundNum: number,
  state: FullGameState
) {
  const currentScore = state.scores[playerId] ?? parseInt(state.mode, 10);
  const settings: MatchSettings = state.parsed_settings || {};
  const format = settings.format || 'single';

  let turnScore = scoreTotal || 0;
  if (darts && darts.length > 0 && !scoreTotal) {
    turnScore = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
  }

  const newScore = currentScore - turnScore;
  const lastDart = darts && darts.length > 0 ? darts[darts.length - 1] : null;
  const isBust =
    newScore < 0 ||
    newScore === 1 ||
    (newScore === 0 && !!lastDart && !lastDart.startsWith('D'));

  const currentSet = state.current_set;
  const currentLeg = state.current_leg;

  db.prepare(
    `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, is_bust, set_num, leg_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gameId, playerId, roundNum,
    darts?.[0] || null, darts?.[1] || null, darts?.[2] || null,
    isBust ? 0 : turnScore,
    isBust ? 1 : 0,
    currentSet, currentLeg
  );

  let gameOver = false;
  let winnerId: number | null = null;

  if (!isBust && newScore === 0) {
    if (format === 'single') {
      db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(playerId, gameId);
      gameOver = true;
      winnerId = playerId;
    } else {
      const result = handleLegWin(gameId, playerId, settings);
      gameOver = result.gameOver;
      winnerId = result.winnerId;
    }
  }

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', newState);

  if (gameOver) {
    io.to(`game:${gameId}`).emit('game-over', { winnerId });
  } else {
    checkAndTriggerAiTurn(io, gameId);
  }
}

function handleLegWin(gameId: number, playerId: number, settings: MatchSettings) {
  const format = settings.format || 'single';
  const bestOfLegs = settings.bestOfLegs || 1;
  const bestOfSets = settings.bestOfSets || 1;
  const bestOfLegsPerSet = settings.bestOfLegsPerSet || bestOfLegs;
  const legsToWin = format === 'sets'
    ? Math.ceil(bestOfLegsPerSet / 2)
    : Math.ceil(bestOfLegs / 2);
  const setsToWin = Math.ceil(bestOfSets / 2);

  db.prepare(
    'UPDATE game_players SET legs_won = legs_won + 1 WHERE game_id = ? AND player_id = ?'
  ).run(gameId, playerId);

  const gp = db.prepare(
    'SELECT * FROM game_players WHERE game_id = ? AND player_id = ?'
  ).get(gameId, playerId) as { legs_won: number; sets_won: number };

  let gameOver = false;
  let winnerId: number | null = null;

  if (format === 'legs') {
    if (gp.legs_won >= legsToWin) {
      db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(playerId, gameId);
      gameOver = true;
      winnerId = playerId;
    }
  } else if (format === 'sets') {
    if (gp.legs_won >= legsToWin) {
      db.prepare(
        'UPDATE game_players SET sets_won = sets_won + 1, legs_won = 0 WHERE game_id = ? AND player_id = ?'
      ).run(gameId, playerId);
      db.prepare(
        'UPDATE game_players SET legs_won = 0 WHERE game_id = ? AND player_id != ?'
      ).run(gameId, playerId);

      const updatedGp = db.prepare(
        'SELECT * FROM game_players WHERE game_id = ? AND player_id = ?'
      ).get(gameId, playerId) as { sets_won: number };

      if (updatedGp.sets_won >= setsToWin) {
        db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
          .run(playerId, gameId);
        gameOver = true;
        winnerId = playerId;
      }
    }
  }

  return { gameOver, winnerId };
}

export function handleCricketTurn(
  io: SocketIOServer,
  gameId: number,
  playerId: number,
  darts: string[],
  roundNum: number,
  state: FullGameState
) {
  if (!darts || darts.length === 0) return;

  const playerState = state.cricket_state?.find((cs) => cs.player_id === playerId);
  if (!playerState) return;
  const opponentStates = (state.cricket_state ?? []).filter((cs) => cs.player_id !== playerId);

  let totalPoints = 0;
  const ps = { ...playerState } as Record<string, number>;

  db.transaction(() => {
    for (const dart of darts) {
      const { number, multiplier } = parseCricketDart(dart);
      if (!number) continue;

      const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
      const currentMarks = ps[col] ?? 0;
      const newMarks = currentMarks + multiplier;

      if (currentMarks >= 3) {
        const allOpponentsClosed = opponentStates.every((os) => (os as unknown as Record<string, number>)[col]! >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * multiplier;
        }
      } else if (newMarks > 3) {
        const excessMarks = newMarks - 3;
        const allOpponentsClosed = opponentStates.every((os) => (os as unknown as Record<string, number>)[col]! >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * excessMarks;
        }
      }

      ps[col] = newMarks;
    }

    db.prepare(
      `UPDATE cricket_state SET
       marks_15 = ?, marks_16 = ?, marks_17 = ?, marks_18 = ?,
       marks_19 = ?, marks_20 = ?, marks_bull = ?, points = points + ?
       WHERE game_id = ? AND player_id = ?`
    ).run(
      ps.marks_15, ps.marks_16, ps.marks_17,
      ps.marks_18, ps.marks_19, ps.marks_20,
      ps.marks_bull, totalPoints, gameId, playerId
    );

    const turnScore = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
    db.prepare(
      `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, cricket_points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(gameId, playerId, roundNum, darts[0] || null, darts[1] || null, darts[2] || null, turnScore, totalPoints);

    const updatedState = db.prepare('SELECT * FROM cricket_state WHERE game_id = ? AND player_id = ?')
      .get(gameId, playerId) as { marks_15: number; marks_16: number; marks_17: number; marks_18: number; marks_19: number; marks_20: number; marks_bull: number; points: number };

    const allClosed = [
      updatedState.marks_15, updatedState.marks_16, updatedState.marks_17,
      updatedState.marks_18, updatedState.marks_19, updatedState.marks_20,
      updatedState.marks_bull,
    ].every((m) => m >= 3);

    if (allClosed) {
      let canWin = true;
      if (opponentStates.length > 0) {
        const allOpponentPoints = opponentStates.map((os) => {
          const fresh = db.prepare('SELECT points FROM cricket_state WHERE game_id = ? AND player_id = ?')
            .get(gameId, os.player_id) as { points: number };
          return fresh.points;
        });
        canWin = allOpponentPoints.every((p) => updatedState.points >= p);
      }
      if (canWin) {
        db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
          .run(playerId, gameId);
      }
    }
  })();

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', newState);

  if (newState?.status === 'completed') {
    io.to(`game:${gameId}`).emit('game-over', { winnerId: playerId });
  } else {
    checkAndTriggerAiTurn(io, gameId);
  }
}

function revertCricketTurn(
  gameId: number,
  turn: { dart1: string | null; dart2: string | null; dart3: string | null; player_id: number; cricket_points?: number }
) {
  const darts = [turn.dart1, turn.dart2, turn.dart3].filter(Boolean) as string[];
  for (const dart of darts) {
    const { number, multiplier } = parseCricketDart(dart);
    if (!number) continue;
    const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
    db.prepare(`UPDATE cricket_state SET ${col} = MAX(0, ${col} - ?) WHERE game_id = ? AND player_id = ?`)
      .run(multiplier, gameId, turn.player_id);
  }
  const pts = turn.cricket_points ?? 0;
  if (pts > 0) {
    db.prepare('UPDATE cricket_state SET points = MAX(0, points - ?) WHERE game_id = ? AND player_id = ?')
      .run(pts, gameId, turn.player_id);
  }
}

export function undoLastTurn(gameId: number): void {
  const lastTurn = db.prepare(
    'SELECT * FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1'
  ).get(gameId) as {
    id: number; dart1: string | null; dart2: string | null; dart3: string | null;
    player_id: number; set_num: number; leg_num: number; cricket_points: number;
  } | undefined;
  if (!lastTurn) return;

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
  if (!game) return;

  db.transaction(() => {
    if (game.status === 'completed') {
      db.prepare("UPDATE games SET status = 'in_progress', winner_id = NULL, finished_at = NULL WHERE id = ?")
        .run(gameId);
    }
    if (game.mode === 'cricket') {
      revertCricketTurn(gameId, lastTurn);
    }
    db.prepare('DELETE FROM turns WHERE id = ?').run(lastTurn.id);
    if (game.mode === '501' || game.mode === '301') {
      rebuildLegsAndSets(gameId, game);
    }
  })();
}

function rebuildLegsAndSets(gameId: number, game: Game): void {
  const settings: MatchSettings = JSON.parse(game.settings || '{}');
  const format = settings.format || 'single';
  if (format === 'single') {
    db.prepare(
      'UPDATE game_players SET legs_won = 0, sets_won = 0 WHERE game_id = ?'
    ).run(gameId);
    return;
  }
  const players = db.prepare(
    'SELECT player_id FROM game_players WHERE game_id = ? ORDER BY position'
  ).all(gameId) as { player_id: number }[];
  const turns = db.prepare(
    'SELECT player_id, score_total, is_bust FROM turns WHERE game_id = ? ORDER BY id'
  ).all(gameId) as { player_id: number; score_total: number; is_bust: number }[];
  const startScore = parseInt(game.mode, 10);
  const legsToWin = format === 'sets'
    ? Math.ceil((settings.bestOfLegsPerSet ?? settings.bestOfLegs ?? 1) / 2)
    : Math.ceil((settings.bestOfLegs ?? 1) / 2);

  const legsWon: Record<number, number> = {};
  const setsWon: Record<number, number> = {};
  const legScores: Record<number, number> = {};
  for (const p of players) {
    legsWon[p.player_id] = 0;
    setsWon[p.player_id] = 0;
    legScores[p.player_id] = startScore;
  }
  for (const t of turns) {
    if (t.is_bust) continue;
    legScores[t.player_id] = legScores[t.player_id]! - t.score_total;
    if (legScores[t.player_id] === 0) {
      legsWon[t.player_id]!++;
      for (const p of players) legScores[p.player_id] = startScore;
      if (format === 'sets' && legsWon[t.player_id]! >= legsToWin) {
        setsWon[t.player_id]!++;
        for (const p of players) legsWon[p.player_id] = 0;
      }
    }
  }
  for (const p of players) {
    db.prepare('UPDATE game_players SET legs_won = ?, sets_won = ? WHERE game_id = ? AND player_id = ?')
      .run(legsWon[p.player_id], setsWon[p.player_id], gameId, p.player_id);
  }
}

function checkAndTriggerAiTurn(io: SocketIOServer, gameId: number) {
  if (aiTurnInProgress.has(gameId)) return;

  const state = getFullGameState(gameId);
  if (!state || state.status !== 'in_progress') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer || !currentPlayer.is_ai) return;

  aiTurnInProgress.add(gameId);
  io.to(`game:${gameId}`).emit('ai-thinking', { playerId: currentPlayer.id });

  const delay = 1000 + Math.random() * 2000;

  setTimeout(() => {
    aiTurnInProgress.delete(gameId);

    const freshState = getFullGameState(gameId);
    if (!freshState || freshState.status !== 'in_progress') return;

    const aiPlayer = freshState.players[freshState.current_player_index];
    if (!aiPlayer || !aiPlayer.is_ai || aiPlayer.id !== currentPlayer.id) return;

    const result = generateAiTurn(aiPlayer.ai_level, freshState.mode, freshState, aiPlayer.id);
    const roundNum = freshState.current_round;

    if (freshState.mode === '501' || freshState.mode === '301') {
      handleX01Turn(io, gameId, aiPlayer.id, result.darts, null, roundNum, freshState);
    } else if (freshState.mode === 'cricket') {
      handleCricketTurn(io, gameId, aiPlayer.id, result.darts, roundNum, freshState);
    }
  }, delay);
}
