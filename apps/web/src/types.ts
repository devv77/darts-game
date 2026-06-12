export type GameMode = '501' | '301' | 'cricket';
export type GameStatus = 'in_progress' | 'completed' | 'abandoned';
export type MatchFormat = 'single' | 'legs' | 'sets';

export interface Player {
  id: number;
  name: string;
  avatar_color: string;
  is_ai: number;
  ai_level: number | null;
  google_id: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: number;
  created_at: string;
}

export interface GamePlayer extends Player {
  position: number;
  sets_won: number;
  legs_won: number;
}

export interface Turn {
  id: number;
  game_id: number;
  player_id: number;
  round_num: number;
  dart1: string | null;
  dart2: string | null;
  dart3: string | null;
  score_total: number;
  is_bust: number;
  set_num: number;
  leg_num: number;
}

export interface CricketState {
  game_id: number;
  player_id: number;
  marks_15: number;
  marks_16: number;
  marks_17: number;
  marks_18: number;
  marks_19: number;
  marks_20: number;
  marks_bull: number;
  points: number;
}

export interface MatchSettings {
  format?: MatchFormat;
  bestOfLegs?: number;
  bestOfSets?: number;
  bestOfLegsPerSet?: number;
  maxPlayers?: number;
}

export interface Game {
  id: number;
  mode: GameMode;
  status: GameStatus;
  winner_id: number | null;
  settings: string;
  created_at: string;
  finished_at: string | null;
  invite_code: string | null;
  is_online: number;
}

export interface FullGameState extends Game {
  parsed_settings: MatchSettings;
  players: GamePlayer[];
  turns: Turn[];
  cricket_state?: CricketState[];
  scores: Record<number, number>;
  current_set: number;
  current_leg: number;
  current_player_index: number;
  current_round: number;
  leg_starting_player_index: number;
  tournament_id: number | null;
  tournament_match_id: number | null;
}

export interface PlayerStats {
  player: Player;
  games_played: number;
  games_won: number;
  win_rate: number | string;
  x01_average: number;
  first_9_average: number;
  highest_turn: number;
  best_leg_darts: number | null;
  count_180: number;
  count_140_plus: number;
  count_100_plus: number;
  total_turns: number;
  bust_count: number;
  bust_rate: number;
  checkout_count: number;
  checkout_pct: number;
  cricket_games_played: number;
  cricket_games_won: number;
  cricket_win_rate: number | string;
}
