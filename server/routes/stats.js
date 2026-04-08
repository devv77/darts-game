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

  // x01 turns from completed games
  const x01Turns = db.prepare(
    `SELECT t.* FROM turns t
     JOIN games g ON g.id = t.game_id
     WHERE t.player_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
  ).all(playerId);

  // Overall 3-dart average (includes busts as 0)
  const totalX01Score = x01Turns.reduce((sum, t) => sum + t.score_total, 0);
  const x01Average = x01Turns.length > 0 ? (totalX01Score / x01Turns.length).toFixed(1) : 0;

  // Highest turn score
  const highest = x01Turns.length > 0 ? Math.max(...x01Turns.map(t => t.score_total)) : 0;

  // Score milestones
  const count180 = x01Turns.filter(t => t.score_total === 180).length;
  const count140plus = x01Turns.filter(t => t.score_total >= 140).length;
  const count100plus = x01Turns.filter(t => t.score_total >= 100).length;
  const countTonPlus = count100plus - count140plus; // 100-139 range

  // Bust count and rate
  const bustCount = x01Turns.filter(t => t.is_bust).length;
  const bustRate = x01Turns.length > 0 ? ((bustCount / x01Turns.length) * 100).toFixed(1) : 0;

  // First-9 average (first 3 turns of each x01 game)
  const x01Games = db.prepare(
    `SELECT g.id FROM games g
     JOIN game_players gp ON gp.game_id = g.id
     WHERE gp.player_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
  ).all(playerId);

  let first9Total = 0;
  let first9Count = 0;
  for (const game of x01Games) {
    const first3Turns = db.prepare(
      `SELECT score_total FROM turns
       WHERE game_id = ? AND player_id = ?
       ORDER BY id LIMIT 3`
    ).all(game.id, playerId);
    for (const t of first3Turns) {
      first9Total += t.score_total;
      first9Count++;
    }
  }
  const first9Average = first9Count > 0 ? (first9Total / first9Count).toFixed(1) : 0;

  // Best leg (fewest darts to finish a won x01 game)
  const wonX01Games = db.prepare(
    `SELECT g.id, g.mode FROM games g
     WHERE g.winner_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
  ).all(playerId);

  let bestLegDarts = null;
  for (const game of wonX01Games) {
    const turns = db.prepare(
      `SELECT dart1, dart2, dart3 FROM turns
       WHERE game_id = ? AND player_id = ? AND is_bust = 0
       ORDER BY id`
    ).all(game.id, playerId);
    let dartCount = 0;
    for (const t of turns) {
      if (t.dart1) dartCount++;
      if (t.dart2) dartCount++;
      if (t.dart3) dartCount++;
    }
    // If no individual darts recorded, count turns * 3
    if (dartCount === 0) dartCount = turns.length * 3;
    if (bestLegDarts === null || dartCount < bestLegDarts) {
      bestLegDarts = dartCount;
    }
  }

  // Checkout percentage (games won / games where player had a chance to checkout)
  // Simplified: wins / games played as a proxy
  const checkoutPct = x01Games.length > 0
    ? ((wonX01Games.length / x01Games.length) * 100).toFixed(1)
    : 0;

  // Doubles hit: count turns where final dart was a double and score reached 0
  // This is the actual checkout count
  const checkoutCount = wonX01Games.length;

  // Cricket stats
  const cricketGamesPlayed = db.prepare(
    `SELECT COUNT(*) as count FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.player_id = ? AND g.mode = 'cricket' AND g.status = 'completed'`
  ).get(playerId).count;

  const cricketGamesWon = db.prepare(
    `SELECT COUNT(*) as count FROM games
     WHERE winner_id = ? AND mode = 'cricket' AND status = 'completed'`
  ).get(playerId).count;

  res.json({
    player,
    // Overall
    games_played: gamesPlayed,
    games_won: gamesWon,
    win_rate: gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : 0,
    // x01
    x01_average: parseFloat(x01Average),
    first_9_average: parseFloat(first9Average),
    highest_turn: highest,
    best_leg_darts: bestLegDarts,
    count_180: count180,
    count_140_plus: count140plus,
    count_100_plus: count100plus,
    total_turns: x01Turns.length,
    bust_count: bustCount,
    bust_rate: parseFloat(bustRate),
    checkout_count: checkoutCount,
    checkout_pct: parseFloat(checkoutPct),
    // Cricket
    cricket_games_played: cricketGamesPlayed,
    cricket_games_won: cricketGamesWon,
    cricket_win_rate: cricketGamesPlayed > 0 ? ((cricketGamesWon / cricketGamesPlayed) * 100).toFixed(1) : 0
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
