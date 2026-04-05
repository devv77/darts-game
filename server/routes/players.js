const express = require('express');
const router = express.Router();
const db = require('../db');

// List all players
router.get('/', (req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY name').all();
  res.json(players);
});

// Create player
router.post('/', (req, res) => {
  const { name, avatar_color, is_ai, ai_level } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Name is required' });
  }
  if (is_ai && (!ai_level || ai_level < 1 || ai_level > 10)) {
    return res.status(400).json({ error: 'AI level must be 1-10' });
  }
  try {
    const result = db.prepare(
      'INSERT INTO players (name, avatar_color, is_ai, ai_level) VALUES (?, ?, ?, ?)'
    ).run(name.trim(), avatar_color || '#3b82f6', is_ai ? 1 : 0, is_ai ? ai_level : null);
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(player);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Player name already exists' });
    }
    throw err;
  }
});

// Update player
router.put('/:id', (req, res) => {
  const { name, avatar_color } = req.body;
  const player = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  try {
    db.prepare('UPDATE players SET name = ?, avatar_color = ? WHERE id = ?')
      .run(name || player.name, avatar_color || player.avatar_color, req.params.id);
    const updated = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(409).json({ error: 'Player name already exists' });
    }
    throw err;
  }
});

// Delete player
router.delete('/:id', (req, res) => {
  const active = db.prepare(
    `SELECT COUNT(*) as count FROM game_players gp
     JOIN games g ON g.id = gp.game_id
     WHERE gp.player_id = ? AND g.status = 'in_progress'`
  ).get(req.params.id);

  if (active.count > 0) {
    return res.status(409).json({ error: 'Player has active games' });
  }

  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

module.exports = router;
