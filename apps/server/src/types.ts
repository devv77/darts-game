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
  created_at: string;
}

export interface Session {
  token: string;
  player_id: number;
  created_at: string;
  expires_at: string;
}

export interface GamePlayer extends Player {
  position: number;
  sets_won: number;
  legs_won: number;
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
  created_at: string;
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
  // Online games (Phase 8a): total human seats; the host plus joiners-by-code.
  maxPlayers?: number;
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

export type DrillType = 'checkout' | 'scoring' | 'around_the_clock' | 'doubles';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PracticeSessionRow {
  id: number;
  player_id: number;
  drill_type: DrillType;
  difficulty: Difficulty | null;
  targets_json: string;
  results_json: string;
  current_index: number;
  current_target_darts: number;
  total_successes: number;
  scoring_total: number;
  darts_thrown: number;
  started_at: string;
  finished_at: string | null;
}

export interface PracticeHistoryRow {
  id: number;
  player_id: number;
  drill_type: DrillType;
  difficulty: Difficulty | null;
  metric_name: string;
  metric_value: number;
  session_date: string;
}

// ── Phase 9 — Tournament Mode ──────────────────────────────────────────────
export type TournamentFormat = 'knockout' | 'league' | 'groups_knockout';
export type TournamentStatus = 'setup' | 'in_progress' | 'completed' | 'abandoned';
export type TournamentMatchStage = 'group' | 'ko' | 'league';
export type TournamentMatchStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';

export interface KnockoutOptions { thirdPlace?: boolean }
export interface LeagueOptions { doubleRoundRobin?: boolean; pointsWin?: number; pointsDraw?: number }
export interface GroupsOptions {
  groupCount?: number;
  advancePerGroup?: number;
  thirdPlace?: boolean;
  doubleRoundRobin?: boolean;
}
export type TournamentOptions = KnockoutOptions & LeagueOptions & GroupsOptions;

export interface TournamentRow {
  id: number;
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  match_settings: string;
  options: string;
  status: TournamentStatus;
  is_online: number;
  winner_id: number | null;
  created_by: number | null;
  created_at: string;
  finished_at: string | null;
}

export interface TournamentPlayerRow {
  tournament_id: number;
  player_id: number;
  seed: number;
  group_label: string | null;
  eliminated: number;
}

export interface TournamentMatchRow {
  id: number;
  tournament_id: number;
  game_id: number | null;
  stage: TournamentMatchStage;
  group_label: string | null;
  round_num: number;
  match_index: number;
  home_player_id: number | null;
  away_player_id: number | null;
  home_legs: number;
  away_legs: number;
  winner_id: number | null;
  status: TournamentMatchStatus;
  next_match_id: number | null;
  next_slot: 'home' | 'away' | null;
  created_at: string;
}
