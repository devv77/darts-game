const express = require('express');
const router = express.Router();
const db = require('../db');

// List games
router.get('/', (req, res) => {
  const { status } = req.query;
  let query = 'SELECT * FROM games';
  const params = [];
  if (status) {
    query += ' WHERE status = ?';
    params.push(status);
  }
  query += ' ORDER BY created_at DESC';
  const games = db.prepare(query).all(...params);
  res.json(games);
});

// Create game
router.post('/', (req, res) => {
  const { mode, player_ids, settings } = req.body;
  if (!mode || !['501', '301', 'cricket'].includes(mode)) {
    return res.status(400).json({ error: 'Invalid mode' });
  }
  const minPlayers = mode === 'cricket' ? 1 : 2;
  if (!player_ids || player_ids.length < minPlayers) {
    return res.status(400).json({ error: `At least ${minPlayers} player(s) required` });
  }

  const createGame = db.transaction(() => {
    const result = db.prepare(
      'INSERT INTO games (mode, settings) VALUES (?, ?)'
    ).run(mode, JSON.stringify(settings || {}));
    const gameId = result.lastInsertRowid;

    const insertPlayer = db.prepare(
      'INSERT INTO game_players (game_id, player_id, position) VALUES (?, ?, ?)'
    );
    player_ids.forEach((pid, i) => insertPlayer.run(gameId, pid, i));

    // Init cricket state if needed
    if (mode === 'cricket') {
      const insertCricket = db.prepare(
        'INSERT INTO cricket_state (game_id, player_id) VALUES (?, ?)'
      );
      player_ids.forEach(pid => insertCricket.run(gameId, pid));
    }

    return gameId;
  });

  const gameId = createGame();
  const game = getFullGameState(gameId);
  res.status(201).json(game);
});

// Get full game state
router.get('/:id', (req, res) => {
  const game = getFullGameState(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  res.json(game);
});

// Abandon game
router.delete('/:id', (req, res) => {
  db.prepare("UPDATE games SET status = 'abandoned', finished_at = datetime('now') WHERE id = ?")
    .run(req.params.id);
  res.status(204).end();
});

function getFullGameState(gameId) {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!game) return null;

  game.players = db.prepare(
    `SELECT p.*, gp.position FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = ? ORDER BY gp.position`
  ).all(gameId);

  game.turns = db.prepare(
    'SELECT * FROM turns WHERE game_id = ? ORDER BY id'
  ).all(gameId);

  if (game.mode === 'cricket') {
    game.cricket_state = db.prepare(
      'SELECT * FROM cricket_state WHERE game_id = ?'
    ).all(gameId);
  }

  // Compute current scores for x01
  if (game.mode === '501' || game.mode === '301') {
    const startScore = parseInt(game.mode);
    game.scores = {};
    game.players.forEach(p => {
      const playerTurns = game.turns.filter(t => t.player_id === p.id && !t.is_bust);
      const totalScored = playerTurns.reduce((sum, t) => sum + t.score_total, 0);
      game.scores[p.id] = startScore - totalScored;
    });
  }

  // Determine whose turn it is
  const totalTurns = game.turns.length;
  const playerCount = game.players.length;
  game.current_player_index = totalTurns % playerCount;
  game.current_round = Math.floor(totalTurns / playerCount) + 1;

  return game;
}

module.exports = router;
module.exports.getFullGameState = getFullGameState;
