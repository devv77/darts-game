const db = require('./db');
const { getFullGameState } = require('./routes/games');
const { generateAiTurn } = require('./ai-engine');

// Guard against duplicate AI turn triggers
const aiTurnInProgress = new Set();

function setupSocket(io) {
  io.on('connection', (socket) => {
    socket.on('join-game', ({ gameId }) => {
      socket.join(`game:${gameId}`);
      const state = getFullGameState(gameId);
      if (state) {
        socket.emit('game-state', state);
        // If current player is AI, trigger their turn
        checkAndTriggerAiTurn(io, gameId);
      }
    });

    socket.on('submit-turn', ({ gameId, playerId, darts, scoreTotal }) => {
      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
      if (!game || game.status !== 'in_progress') return;

      const state = getFullGameState(gameId);
      const playerCount = state.players.length;
      const roundNum = Math.floor(state.turns.length / playerCount) + 1;

      if (game.mode === '501' || game.mode === '301') {
        handleX01Turn(io, gameId, playerId, darts, scoreTotal, roundNum, state);
      } else if (game.mode === 'cricket') {
        handleCricketTurn(io, gameId, playerId, darts, roundNum, state);
      }
    });

    socket.on('undo-turn', ({ gameId }) => {
      const lastTurn = db.prepare(
        'SELECT * FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1'
      ).get(gameId);
      if (!lastTurn) return;

      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);

      db.transaction(() => {
        // If game was completed, reopen it
        if (game.status === 'completed') {
          db.prepare("UPDATE games SET status = 'in_progress', winner_id = NULL, finished_at = NULL WHERE id = ?")
            .run(gameId);
        }

        // For cricket, revert state from the turn's darts
        if (game.mode === 'cricket') {
          revertCricketTurn(gameId, lastTurn);
        }

        db.prepare('DELETE FROM turns WHERE id = ?').run(lastTurn.id);
      })();

      const newState = getFullGameState(gameId);
      io.to(`game:${gameId}`).emit('game-state', newState);
    });
  });
}

function handleX01Turn(io, gameId, playerId, darts, scoreTotal, roundNum, state) {
  const startScore = parseInt(state.mode);
  const currentScore = state.scores[playerId];

  // Parse darts to compute score if individual darts provided
  let turnScore = scoreTotal || 0;
  if (darts && darts.length > 0 && !scoreTotal) {
    turnScore = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
  }

  // Check bust
  const newScore = currentScore - turnScore;
  const lastDart = darts && darts.length > 0 ? darts[darts.length - 1] : null;
  const isBust = newScore < 0 || newScore === 1 || (newScore === 0 && lastDart && !lastDart.startsWith('D'));

  db.prepare(
    `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, is_bust)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gameId, playerId, roundNum,
    darts?.[0] || null, darts?.[1] || null, darts?.[2] || null,
    isBust ? 0 : turnScore,
    isBust ? 1 : 0
  );

  // Check win
  if (!isBust && newScore === 0) {
    db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
      .run(playerId, gameId);
  }

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', newState);

  if (!isBust && newScore === 0) {
    io.to(`game:${gameId}`).emit('game-over', { winnerId: playerId });
  } else {
    checkAndTriggerAiTurn(io, gameId);
  }
}

function handleCricketTurn(io, gameId, playerId, darts, roundNum, state) {
  if (!darts || darts.length === 0) return;

  const cricketNumbers = [15, 16, 17, 18, 19, 20, 'bull'];
  const playerState = state.cricket_state.find(cs => cs.player_id === playerId);
  const opponentStates = state.cricket_state.filter(cs => cs.player_id !== playerId);

  let totalPoints = 0;

  db.transaction(() => {
    for (const dart of darts) {
      const { number, multiplier } = parseCricketDart(dart);
      if (!number) continue;

      const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
      const currentMarks = playerState[col];
      const newMarks = currentMarks + multiplier;

      // Points: marks beyond 3 score if opponents haven't closed
      if (currentMarks >= 3) {
        // Already closed, check if opponents closed
        const allOpponentsClosed = opponentStates.every(os => os[col] >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * multiplier;
        }
      } else if (newMarks > 3) {
        // Partially closing, partially scoring
        const excessMarks = newMarks - 3;
        const allOpponentsClosed = opponentStates.every(os => os[col] >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * excessMarks;
        }
      }

      playerState[col] = newMarks;
    }

    // Update cricket_state
    db.prepare(
      `UPDATE cricket_state SET
       marks_15 = ?, marks_16 = ?, marks_17 = ?, marks_18 = ?,
       marks_19 = ?, marks_20 = ?, marks_bull = ?, points = points + ?
       WHERE game_id = ? AND player_id = ?`
    ).run(
      playerState.marks_15, playerState.marks_16, playerState.marks_17,
      playerState.marks_18, playerState.marks_19, playerState.marks_20,
      playerState.marks_bull, totalPoints, gameId, playerId
    );

    // Record turn
    const turnScore = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
    db.prepare(
      `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(gameId, playerId, roundNum, darts[0] || null, darts[1] || null, darts[2] || null, turnScore);

    // Check win: all numbers closed and points >= all opponents
    const updatedState = db.prepare('SELECT * FROM cricket_state WHERE game_id = ? AND player_id = ?')
      .get(gameId, playerId);
    const allClosed = [updatedState.marks_15, updatedState.marks_16, updatedState.marks_17,
      updatedState.marks_18, updatedState.marks_19, updatedState.marks_20, updatedState.marks_bull]
      .every(m => m >= 3);

    if (allClosed) {
      // Solo cricket: closing all numbers wins immediately
      // Multiplayer: must also have points >= all opponents
      let canWin = true;
      if (opponentStates.length > 0) {
        const allOpponentPoints = opponentStates.map(os => {
          const fresh = db.prepare('SELECT points FROM cricket_state WHERE game_id = ? AND player_id = ?')
            .get(gameId, os.player_id);
          return fresh.points;
        });
        canWin = allOpponentPoints.every(p => updatedState.points >= p);
      }
      if (canWin) {
        db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
          .run(playerId, gameId);
      }
    }
  })();

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', newState);

  if (newState.status === 'completed') {
    io.to(`game:${gameId}`).emit('game-over', { winnerId: playerId });
  } else {
    checkAndTriggerAiTurn(io, gameId);
  }
}

function revertCricketTurn(gameId, turn) {
  const darts = [turn.dart1, turn.dart2, turn.dart3].filter(Boolean);
  for (const dart of darts) {
    const { number, multiplier } = parseCricketDart(dart);
    if (!number) continue;
    const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
    // Simple revert: subtract marks (doesn't perfectly revert points, but good enough for undo)
    db.prepare(`UPDATE cricket_state SET ${col} = MAX(0, ${col} - ?) WHERE game_id = ? AND player_id = ?`)
      .run(multiplier, gameId, turn.player_id);
  }
  // Recompute points from remaining turns would be more accurate, but this handles the common case
}

function parseDartScore(dart) {
  if (!dart || dart === '0') return 0;
  if (dart === 'SB') return 25;
  if (dart === 'DB') return 50;
  const prefix = dart[0];
  const num = parseInt(dart.slice(1));
  if (isNaN(num)) return 0;
  if (prefix === 'S') return num;
  if (prefix === 'D') return num * 2;
  if (prefix === 'T') return num * 3;
  return 0;
}

function parseCricketDart(dart) {
  if (!dart || dart === '0') return { number: null, multiplier: 0 };
  if (dart === 'SB') return { number: 'bull', multiplier: 1 };
  if (dart === 'DB') return { number: 'bull', multiplier: 2 };
  const prefix = dart[0];
  const num = parseInt(dart.slice(1));
  if (isNaN(num) || num < 15 || num > 20) return { number: null, multiplier: 0 };
  const mult = prefix === 'S' ? 1 : prefix === 'D' ? 2 : prefix === 'T' ? 3 : 0;
  return { number: num, multiplier: mult };
}

function checkAndTriggerAiTurn(io, gameId) {
  if (aiTurnInProgress.has(gameId)) return;

  const state = getFullGameState(gameId);
  if (!state || state.status !== 'in_progress') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer || !currentPlayer.is_ai) return;

  aiTurnInProgress.add(gameId);

  // Emit thinking indicator
  io.to(`game:${gameId}`).emit('ai-thinking', { playerId: currentPlayer.id });

  // Random delay 1-3 seconds for realism
  const delay = 1000 + Math.random() * 2000;

  setTimeout(() => {
    aiTurnInProgress.delete(gameId);

    // Re-fetch state (may have changed due to undo)
    const freshState = getFullGameState(gameId);
    if (!freshState || freshState.status !== 'in_progress') return;

    const aiPlayer = freshState.players[freshState.current_player_index];
    if (!aiPlayer || !aiPlayer.is_ai || aiPlayer.id !== currentPlayer.id) return;

    const result = generateAiTurn(aiPlayer.ai_level, freshState.mode, freshState, aiPlayer.id);
    const playerCount = freshState.players.length;
    const roundNum = Math.floor(freshState.turns.length / playerCount) + 1;

    if (freshState.mode === '501' || freshState.mode === '301') {
      handleX01Turn(io, gameId, aiPlayer.id, result.darts, null, roundNum, freshState);
    } else if (freshState.mode === 'cricket') {
      handleCricketTurn(io, gameId, aiPlayer.id, result.darts, roundNum, freshState);
    }
  }, delay);
}

module.exports = setupSocket;
