// Tournament Mode client contract — shared by Home, Setup, and TournamentPage.
// The server (apps/server/src/routes/tournaments.ts + tournament-store.ts)
// returns these exact camelCase shapes. DB columns are snake_case; the store maps them.

import { api } from './api';
import type { GameMode, MatchSettings, Player } from '../types';

export type TournamentFormat = 'knockout' | 'league' | 'groups_knockout';
export type TournamentStatus = 'setup' | 'in_progress' | 'completed' | 'abandoned';
export type TournamentMatchStatus = 'pending' | 'ready' | 'in_progress' | 'completed' | 'bye';

export interface TournamentOptions {
  thirdPlace?: boolean;
  doubleRoundRobin?: boolean;
  pointsWin?: number;
  pointsDraw?: number;
  groupCount?: number;
  advancePerGroup?: number;
}

export interface TournamentMatch {
  id: number;
  tournamentId: number;
  gameId: number | null;
  stage: string;
  groupLabel: string | null;
  roundNum: number;
  matchIndex: number;
  homePlayerId: number | null;
  awayPlayerId: number | null;
  homeLegs: number;
  awayLegs: number;
  winnerId: number | null;
  status: TournamentMatchStatus;
  nextMatchId: number | null;
  nextSlot: 'home' | 'away' | null;
}

export interface TournamentPlayerInfo {
  player: Player;
  seed: number;
  groupLabel: string | null;
  eliminated: boolean;
}

export interface StandingsRow {
  playerId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  legsFor: number;
  legsAgainst: number;
  legDiff: number;
  points: number;
}

export interface TournamentState {
  id: number;
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  status: TournamentStatus;
  isOnline: boolean;
  inviteCode: string | null;
  targetSize: number | null;
  matchSettings: MatchSettings;
  options: TournamentOptions;
  winnerId: number | null;
  createdBy: number | null;
  players: TournamentPlayerInfo[];
  matches: TournamentMatch[];
  standings: StandingsRow[] | null;
  createdAt: string;
  finishedAt: string | null;
}

/** Lightweight row from the list endpoint (no players/matches). */
export interface TournamentSummary {
  id: number;
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  status: TournamentStatus;
  winner_id: number | null;
  created_at: string;
}

export interface FormatMeta {
  format: TournamentFormat;
  name: string;
  icon: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  available: boolean; // false = designed but not wired yet (T2/T3)
}

export const FORMATS: FormatMeta[] = [
  {
    format: 'knockout',
    name: 'Knockout',
    icon: '🏆',
    description: 'Single elimination. Win or go home, last one standing takes the cup.',
    minPlayers: 2, maxPlayers: 32, available: true,
  },
  {
    format: 'league',
    name: 'League',
    icon: '📊',
    description: 'Round-robin. Everyone plays everyone; points decide the table.',
    minPlayers: 3, maxPlayers: 16, available: true,
  },
  {
    format: 'groups_knockout',
    name: 'Groups → Knockout',
    icon: '🗂️',
    description: 'Group stage feeds a seeded knockout. World-Cup style.',
    minPlayers: 4, maxPlayers: 32, available: false,
  },
];

export const formatMeta = (format: TournamentFormat): FormatMeta =>
  FORMATS.find((f) => f.format === format) ?? FORMATS[0]!;

/** Human round name for a knockout bracket of `totalRounds` rounds. */
export function roundName(roundNum: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNum; // 0 = final
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-Finals';
  if (fromEnd === 2) return 'Quarter-Finals';
  return `Round ${roundNum}`;
}

export interface CreateTournamentInput {
  name: string;
  format: TournamentFormat;
  mode: GameMode;
  matchSettings: MatchSettings;
  options: TournamentOptions;
  playerIds?: number[]; // single-device only
  isOnline?: boolean;
  targetSize?: number;  // online only: seats to fill before the bracket starts
}

export const createTournament = (input: CreateTournamentInput) =>
  api.post<TournamentState>('/api/tournaments', input);

export const getTournament = (id: number) =>
  api.get<TournamentState>(`/api/tournaments/${id}`);

export const listTournaments = (status?: string) =>
  api.get<TournamentSummary[]>(`/api/tournaments${status ? `?status=${status}` : ''}`);

export const launchTournamentMatch = (tournamentId: number, matchId: number) =>
  api.post<{ gameId: number }>(`/api/tournaments/${tournamentId}/matches/${matchId}/launch`, {});

export const joinTournament = (code: string) =>
  api.post<TournamentState>('/api/tournaments/join', { code });

export const startTournament = (id: number) =>
  api.post<TournamentState>(`/api/tournaments/${id}/start`, {});

export const deleteTournament = (id: number) =>
  api.del(`/api/tournaments/${id}`);
