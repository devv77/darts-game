import { db } from './db.js';
import { applyAtcDart, ATC_TARGET_COUNT, atcTarget } from './darts.js';
import type { FullGameState, Game, GamePlayer, Turn, CricketState, AtcState, MatchSettings } from './types.js';

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

  // Around-the-Clock progress is derived (not stored): replay each player's
  // darts in order under the configured advance rule.
  let atc_state: AtcState[] | undefined;
  if (game.mode === 'atc') {
    const advance = parsed_settings.atcAdvance === 'multiplier' ? 'multiplier' : 'single';
    atc_state = players.map((p) => {
      let hits = 0;
      for (const t of turns) {
        if (t.player_id !== p.id) continue;
        for (const d of [t.dart1, t.dart2, t.dart3]) {
          if (hits >= ATC_TARGET_COUNT) break;
          hits = applyAtcDart(hits, d, advance);
        }
      }
      return {
        player_id: p.id,
        hits,
        target: hits >= ATC_TARGET_COUNT ? ATC_TARGET_COUNT : atcTarget(hits),
        completed: hits >= ATC_TARGET_COUNT,
      };
    });
  }

  // If this game backs a tournament match, surface the link so the UI can show
  // a "Back to tournament" affordance and context banner (Phase 9).
  const tmatch = db.prepare(
    'SELECT id, tournament_id FROM tournament_matches WHERE game_id = ?'
  ).get(gameId) as { id: number; tournament_id: number } | undefined;
  const tournament_id = tmatch ? tmatch.tournament_id : null;
  const tournament_match_id = tmatch ? tmatch.id : null;

  const totalLegsWon = players.reduce((sum, p) => sum + p.legs_won, 0);
  const totalSetsWon = players.reduce((sum, p) => sum + p.sets_won, 0);
  const current_set = totalSetsWon + 1;
  const current_leg = totalLegsWon + 1;

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
    // Count legs completed across the whole match by replaying turns. A set can
    // end in fewer legs than there are players (e.g. first-to-3 with 2 players),
    // so the leg ordinal cannot be derived from current_set/current_leg — the
    // old `(current_set - 1) * playerCount` assumed playerCount legs per set and
    // put the wrong player on throw for every leg after an uneven set.
    let completedLegs = 0;
    const running: Record<number, number> = {};
    for (const p of players) running[p.id] = startScore;
    for (const t of turns) {
      if (t.is_bust) continue;
      running[t.player_id] = (running[t.player_id] ?? startScore) - t.score_total;
      if (running[t.player_id] === 0) {
        completedLegs++;
        for (const p of players) running[p.id] = startScore;
      }
    }
    leg_starting_player_index = completedLegs % playerCount;
    current_player_index = (leg_starting_player_index + currentLegTurnCount) % playerCount;
    current_round = Math.floor(currentLegTurnCount / playerCount) + 1;
  } else {
    // Cricket + Around-the-Clock: one turn per player per round, in seat order.
    const totalTurns = turns.length;
    current_player_index = totalTurns % playerCount;
    current_round = Math.floor(totalTurns / playerCount) + 1;
    leg_starting_player_index = 0;
    if (atc_state) for (const a of atc_state) scores[a.player_id] = a.hits;
  }

  return {
    ...game,
    parsed_settings,
    players,
    turns,
    cricket_state,
    atc_state,
    scores,
    current_set,
    current_leg,
    current_player_index,
    current_round,
    leg_starting_player_index,
    tournament_id,
    tournament_match_id,
  };
}
