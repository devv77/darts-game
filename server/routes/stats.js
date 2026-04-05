const express = require('express');
const router = express.Router();
const db = require('../db');

// Player lifetime stats
router.get('/players/:id', (req, res) => {
  const playerId = req.params.id;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  const gamesPlayed = db.prepare(
    `SELECT COUNT(*) as count FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.player_id = ? AND g.status = 'completed'`
  ).get(playerId).count;

  const gamesWon = db.prepare(
    `SELECT COUNT(*) as count FROM games
     WHERE winner_id = ? AND status = 'completed'`
  ).get(playerId).count;

  // x01 stats
  const x01Turns = db.prepare(
    `SELECT t.* FROM turns t
     JOIN games g ON g.id = t.game_id
     WHERE t.player_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
  ).all(playerId);

  const totalX01Score = x01Turns.reduce((sum, t) => sum + t.score_total, 0);
  const x01Average = x01Turns.length > 0 ? (totalX01Score / x01Turns.length).toFixed(1) : 0;
  const highest = x01Turns.length > 0 ? Math.max(...x01Turns.map(t => t.score_total)) : 0;
  const count180 = x01Turns.filter(t => t.score_total === 180).length;
  const count140plus = x01Turns.filter(t => t.score_total >= 140).length;

  res.json({
    player,
    games_played: gamesPlayed,
    games_won: gamesWon,
    win_rate: gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : 0,
    x01_average: parseFloat(x01Average),
    highest_turn: highest,
    count_180: count180,
    count_140_plus: count140plus,
    total_turns: x01Turns.length
  });
});

// Game stats
router.get('/games/:id', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const players = db.prepare(
    `SELECT p.*, gp.position FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = ? ORDER BY gp.position`
  ).all(req.params.id);

  const turns = db.prepare(
    'SELECT * FROM turns WHERE game_id = ? ORDER BY id'
  ).all(req.params.id);

  const playerStats = players.map(p => {
    const pTurns = turns.filter(t => t.player_id === p.id);
    const validTurns = pTurns.filter(t => !t.is_bust);
    const totalScore = validTurns.reduce((sum, t) => sum + t.score_total, 0);
    return {
      player: p,
      turns: pTurns.length,
      average: pTurns.length > 0 ? (totalScore / pTurns.length).toFixed(1) : 0,
      highest: pTurns.length > 0 ? Math.max(...pTurns.map(t => t.score_total)) : 0,
      busts: pTurns.filter(t => t.is_bust).length
    };
  });

  res.json({ game, player_stats: playerStats });
});

module.exports = router;
