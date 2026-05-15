import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import type { Game, GamePlayer, Player, Turn } from '../types.js';

function countDarts(t: Turn): number {
  const d = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
  return d > 0 ? d : 3;
}

function computeAvg(pTurns: Turn[]): string {
  if (pTurns.length === 0) return '0';
  let totalScore = 0, totalDarts = 0;
  for (const t of pTurns) {
    totalScore += t.score_total;
    totalDarts += countDarts(t);
  }
  return totalDarts > 0 ? ((totalScore / totalDarts) * 3).toFixed(1) : '0';
}

export async function statsRoutes(app: FastifyInstance) {
  app.get<{ Params: { id: string } }>('/api/stats/players/:id', async (req, reply) => {
    const playerId = req.params.id;
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as Player | undefined;
    if (!player) return reply.code(404).send({ error: 'Player not found' });

    const gamesPlayed = (db.prepare(
      `SELECT COUNT(*) as count FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.player_id = ? AND g.status = 'completed'`
    ).get(playerId) as { count: number }).count;

    const gamesWon = (db.prepare(
      `SELECT COUNT(*) as count FROM games
       WHERE winner_id = ? AND status = 'completed'`
    ).get(playerId) as { count: number }).count;

    const x01Turns = db.prepare(
      `SELECT t.* FROM turns t
       JOIN games g ON g.id = t.game_id
       WHERE t.player_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
    ).all(playerId) as Turn[];

    const totalX01Score = x01Turns.reduce((s, t) => s + t.score_total, 0);
    let totalDartsThrown = 0;
    for (const t of x01Turns) {
      const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
      totalDartsThrown += darts > 0 ? darts : 3;
    }
    const x01Average = totalDartsThrown > 0 ? ((totalX01Score / totalDartsThrown) * 3).toFixed(1) : '0';
    const highest = x01Turns.length > 0 ? Math.max(...x01Turns.map((t) => t.score_total)) : 0;

    const count180 = x01Turns.filter((t) => t.score_total === 180).length;
    const count140plus = x01Turns.filter((t) => t.score_total >= 140).length;
    const count100plus = x01Turns.filter((t) => t.score_total >= 100).length;

    const bustCount = x01Turns.filter((t) => t.is_bust).length;
    const bustRate = x01Turns.length > 0 ? ((bustCount / x01Turns.length) * 100).toFixed(1) : '0';

    const x01Games = db.prepare(
      `SELECT g.id FROM games g
       JOIN game_players gp ON gp.game_id = g.id
       WHERE gp.player_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
    ).all(playerId) as { id: number }[];

    let first9Total = 0;
    let first9Darts = 0;
    for (const game of x01Games) {
      const first3Turns = db.prepare(
        `SELECT score_total, dart1, dart2, dart3 FROM turns
         WHERE game_id = ? AND player_id = ?
         ORDER BY id LIMIT 3`
      ).all(game.id, playerId) as Turn[];
      for (const t of first3Turns) {
        first9Total += t.score_total;
        const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
        first9Darts += darts > 0 ? darts : 3;
      }
    }
    const first9Average = first9Darts > 0 ? ((first9Total / first9Darts) * 3).toFixed(1) : '0';

    const wonX01Games = db.prepare(
      `SELECT g.id, g.mode FROM games g
       WHERE g.winner_id = ? AND g.mode IN ('501', '301') AND g.status = 'completed'`
    ).all(playerId) as { id: number }[];

    let bestLegDarts: number | null = null;
    for (const game of wonX01Games) {
      const turns = db.prepare(
        `SELECT dart1, dart2, dart3 FROM turns
         WHERE game_id = ? AND player_id = ? AND is_bust = 0
         ORDER BY id`
      ).all(game.id, playerId) as Turn[];
      let dartCount = 0;
      for (const t of turns) {
        if (t.dart1) dartCount++;
        if (t.dart2) dartCount++;
        if (t.dart3) dartCount++;
      }
      if (dartCount === 0) dartCount = turns.length * 3;
      if (bestLegDarts === null || dartCount < bestLegDarts) {
        bestLegDarts = dartCount;
      }
    }

    const checkoutPct = x01Games.length > 0
      ? ((wonX01Games.length / x01Games.length) * 100).toFixed(1)
      : '0';

    const cricketGamesPlayed = (db.prepare(
      `SELECT COUNT(*) as count FROM game_players gp
       JOIN games g ON g.id = gp.game_id
       WHERE gp.player_id = ? AND g.mode = 'cricket' AND g.status = 'completed'`
    ).get(playerId) as { count: number }).count;

    const cricketGamesWon = (db.prepare(
      `SELECT COUNT(*) as count FROM games
       WHERE winner_id = ? AND mode = 'cricket' AND status = 'completed'`
    ).get(playerId) as { count: number }).count;

    return {
      player,
      games_played: gamesPlayed,
      games_won: gamesWon,
      win_rate: gamesPlayed > 0 ? ((gamesWon / gamesPlayed) * 100).toFixed(1) : '0',
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
      checkout_count: wonX01Games.length,
      checkout_pct: parseFloat(checkoutPct),
      cricket_games_played: cricketGamesPlayed,
      cricket_games_won: cricketGamesWon,
      cricket_win_rate: cricketGamesPlayed > 0 ? ((cricketGamesWon / cricketGamesPlayed) * 100).toFixed(1) : '0',
    };
  });

  app.get<{ Params: { id: string } }>('/api/stats/games/:id', async (req, reply) => {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id) as Game | undefined;
    if (!game) return reply.code(404).send({ error: 'Game not found' });

    const players = db.prepare(
      `SELECT p.*, gp.position, gp.sets_won, gp.legs_won FROM game_players gp
       JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = ? ORDER BY gp.position`
    ).all(req.params.id) as GamePlayer[];

    const turns = db.prepare('SELECT * FROM turns WHERE game_id = ? ORDER BY id').all(req.params.id) as Turn[];

    const playerStats = players.map((p) => {
      const pTurns = turns.filter((t) => t.player_id === p.id);
      let totalDarts = 0;
      for (const t of pTurns) totalDarts += countDarts(t);
      return {
        player: p,
        turns: pTurns.length,
        darts: totalDarts,
        average: computeAvg(pTurns),
        highest: pTurns.length > 0 ? Math.max(...pTurns.map((t) => t.score_total)) : 0,
        busts: pTurns.filter((t) => t.is_bust).length,
        count_180: pTurns.filter((t) => t.score_total === 180).length,
        count_140_plus: pTurns.filter((t) => t.score_total >= 140).length,
        count_100_plus: pTurns.filter((t) => t.score_total >= 100).length,
      };
    });

    const legSet = new Set<string>();
    for (const t of turns) {
      legSet.add((t.set_num || 1) + ':' + (t.leg_num || 1));
    }
    const legsPlayed = Array.from(legSet).map((k) => {
      const [s, l] = k.split(':').map(Number) as [number, number];
      return { set: s, leg: l };
    }).sort((a, b) => a.set - b.set || a.leg - b.leg);

    const legStats = legsPlayed.map((leg) => {
      const legTurns = turns.filter((t) => (t.set_num || 1) === leg.set && (t.leg_num || 1) === leg.leg);
      const perPlayer = players.map((p) => {
        const pTurns = legTurns.filter((t) => t.player_id === p.id);
        let darts = 0;
        for (const t of pTurns) darts += countDarts(t);
        return {
          player_id: p.id,
          turns: pTurns.length,
          darts,
          average: computeAvg(pTurns),
          highest: pTurns.length > 0 ? Math.max(...pTurns.map((t) => t.score_total)) : 0,
          busts: pTurns.filter((t) => t.is_bust).length,
        };
      });
      return { set: leg.set, leg: leg.leg, player_stats: perPlayer };
    });

    return { game, player_stats: playerStats, leg_stats: legStats };
  });
}
