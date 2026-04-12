const express = require('express');
const router = express.Router();
const db = require('../db');

// DELETE /api/admin/reset — Wipe all players (non-AI) and all games/turns/cricket data
router.delete('/reset', (req, res) => {
  db.transaction(() => {
    db.exec('DELETE FROM cricket_state');
    db.exec('DELETE FROM turns');
    db.exec('DELETE FROM game_players');
    db.exec('DELETE FROM games');
    db.exec('DELETE FROM players WHERE is_ai = 0');
  })();

  res.json({ message: 'All games and human players deleted' });
});

module.exports = router;
