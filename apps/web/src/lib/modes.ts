import type { GameMode } from '../types';

export interface MatchModeMeta {
  mode: GameMode;
  name: string;
  icon: string;
  description: string;
}

export const MATCH_MODES: MatchModeMeta[] = [
  { mode: '501', name: '501', icon: '🎯', description: 'Race from 501 to zero, finish on a double.' },
  { mode: '301', name: '301', icon: '⚡', description: 'Shorter 301 sprint, double to finish.' },
  { mode: 'cricket', name: 'Cricket', icon: '🎪', description: 'Close 15–20 + Bull, out-score your rival.' },
  { mode: 'atc', name: 'Around the Clock', icon: '🕐', description: 'Race 1→20 then Bull, in order.' },
];

export const matchModeMeta = (mode: GameMode): MatchModeMeta =>
  MATCH_MODES.find((m) => m.mode === mode) ?? MATCH_MODES[0]!;
