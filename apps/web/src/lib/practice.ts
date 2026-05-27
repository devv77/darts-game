// Practice Mode client contract — shared by PracticePage, Lobby, and Stats.
// The server (apps/server/src/routes/practice.ts + practice-engine.ts) returns
// these exact shapes (camelCase). DB columns are snake_case; the route maps them.

import { api } from './api';

export type DrillType = 'checkout' | 'scoring' | 'around_the_clock' | 'doubles';
export type Difficulty = 'easy' | 'medium' | 'hard';

export interface PracticeTarget {
  /** Big display token, e.g. "81", "D16", "7", "Bull", "Round 3". */
  label: string;
  /** Optional sub-hint, e.g. a checkout path "T17 D15" for the checkout drill. */
  hint?: string;
}

export interface PracticeResult {
  targetIndex: number;
  label: string;
  /** checkout/doubles: did the player finish the target. scoring/atb: always true once recorded. */
  success: boolean;
  dartsUsed: number;
  /** Human-readable detail, e.g. "81 → 0 via T17 D24" or "140". */
  detail?: string;
  /** scoring drill only: the round's point total. */
  scoreValue?: number;
}

export interface PracticeMetrics {
  drillType: DrillType;
  targetsTotal: number;
  targetsDone: number;
  dartsThrown: number;
  // checkout / doubles
  successRate?: number; // 0..1
  avgDartsPerSuccess?: number;
  // scoring
  threeDartAvg?: number;
  lifetimeAvg?: number; // player's lifetime 501/301 average, for comparison
  // around_the_clock
  elapsedMs?: number;
  // doubles weakness heatmap
  perDouble?: Record<string, { hits: number; attempts: number }>;
}

export interface PracticeState {
  id: number;
  playerId: number;
  drillType: DrillType;
  difficulty: Difficulty | null;
  targets: PracticeTarget[];
  results: PracticeResult[];
  currentIndex: number;
  /** Darts already spent on the current target (resets when target advances). */
  currentTargetDarts: number;
  finished: boolean;
  startedAt: string;
  finishedAt: string | null;
  metrics: PracticeMetrics;
}

export interface PracticeHistoryEntry {
  id: number;
  drillType: DrillType;
  difficulty: Difficulty | null;
  metricName: string;
  metricValue: number;
  sessionDate: string;
}

export interface DrillMeta {
  type: DrillType;
  name: string;
  icon: string; // emoji
  description: string;
  hasDifficulty: boolean;
  /** Input style the practice page should render for this drill. */
  input: 'darts' | 'numpad';
}

export const DRILLS: DrillMeta[] = [
  {
    type: 'checkout',
    name: 'Checkout',
    icon: '🎯',
    description: '10 random checkouts. Finish on a double in 3 darts.',
    hasDifficulty: true,
    input: 'darts',
  },
  {
    type: 'scoring',
    name: 'Scoring',
    icon: '💯',
    description: '10 rounds of pure scoring. Beat your average.',
    hasDifficulty: false,
    input: 'numpad',
  },
  {
    type: 'around_the_clock',
    name: 'Around the Clock',
    icon: '🕐',
    description: 'Hit 1–20 then Bull in sequence. Any segment counts.',
    hasDifficulty: false,
    input: 'darts',
  },
  {
    type: 'doubles',
    name: 'Doubles',
    icon: '✌️',
    description: '10 random doubles. Up to 9 darts each. Builds a weakness map.',
    hasDifficulty: false,
    input: 'darts',
  },
];

export interface CreatePracticeInput {
  playerId: number;
  drillType: DrillType;
  difficulty?: Difficulty;
}

export interface PracticeTurnInput {
  /** Dart notation for darts drills: S1..S20, D1..D20, T1..T20, SB, DB, 0. */
  darts?: string[];
  /** Scoring drill: 0..180 quick total. */
  scoreTotal?: number;
}

export const createPractice = (input: CreatePracticeInput) =>
  api.post<PracticeState>('/api/practice', input);

export const getPracticeState = (id: number) =>
  api.get<PracticeState>(`/api/practice/${id}`);

export const submitPracticeTurn = (id: number, turn: PracticeTurnInput) =>
  api.post<PracticeState>(`/api/practice/${id}/turn`, turn);

export const getPracticeHistory = (playerId: number) =>
  api.get<PracticeHistoryEntry[]>(`/api/practice/history/${playerId}`);
