import { db } from './db.js';
import type { FullGameState, Game, GamePlayer, Turn, CricketState, MatchSettings } from './types.js';

export function getFullGameState(gameId: number | string): FullGameState | null {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
  if (!game) return null;

  const parsed_settings: MatchSettings = JSON.parse(game.settings || '{}');

  const players = db.prepare(
    `SELECT p.*, gp.position, gp.sets_won, gp.legs_won FROM game_players gp
     JOIN players p ON p.id = gp.player_id
     WHERE gp.game_id = ? ORDER BY gp.position`
  ).all(gameId) as GamePlayer[];

  const turns = db.prepare(
    'SELECT * FROM turns WHERE game_id = ? ORDER BY id'
  ).all(gameId) as Turn[];

  let cricket_state: CricketState[] | undefined;
  if (game.mode === 'cricket') {
    cricket_state = db.prepare(
      'SELECT * FROM cricket_state WHERE game_id = ?'
    ).all(gameId) as CricketState[];
  }

  const lastTurn = turns.length > 0 ? turns[turns.length - 1]! : null;
  const current_set = lastTurn ? lastTurn.set_num : 1;
  const current_leg = lastTurn ? lastTurn.leg_num : 1;

  const scores: Record<number, number> = {};
  let current_player_index = 0;
  let current_round = 1;
  let leg_starting_player_index = 0;

  const playerCount = players.length || 1;

  if (game.mode === '501' || game.mode === '301') {
    const startScore = parseInt(game.mode, 10);
    const currentLegTurns = turns.filter(
      (t) => t.set_num === current_set && t.leg_num === current_leg
    );
    for (const p of players) {
      const playerTurns = currentLegTurns.filter((t) => t.player_id === p.id && !t.is_bust);
      const totalScored = playerTurns.reduce((sum, t) => sum + t.score_total, 0);
      scores[p.id] = startScore - totalScored;
    }

    const currentLegTurnCount = currentLegTurns.length;
    const totalLegsPlayed = (current_set - 1) * playerCount + (current_leg - 1);
    leg_starting_player_index = totalLegsPlayed % playerCount;
    current_player_index = (leg_starting_player_index + currentLegTurnCount) % playerCount;
    current_round = Math.floor(currentLegTurnCount / playerCount) + 1;
  } else {
    const totalTurns = turns.length;
    current_player_index = totalTurns % playerCount;
    current_round = Math.floor(totalTurns / playerCount) + 1;
    leg_starting_player_index = 0;
  }

  return {
    ...game,
    parsed_settings,
    players,
    turns,
    cricket_state,
    scores,
    current_set,
    current_leg,
    current_player_index,
    current_round,
    leg_starting_player_index,
  };
}
