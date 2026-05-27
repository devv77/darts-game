import { parseDartScore, isValidDart } from './darts.js';
import { checkouts } from './checkout-table.js';
import type { DrillType, Difficulty, PracticeSessionRow } from './types.js';

export interface PracticeTarget {
  label: string;
  hint?: string;
}

export interface PracticeResult {
  targetIndex: number;
  label: string;
  success: boolean;
  dartsUsed: number;
  detail?: string;
  scoreValue?: number;
}

export interface PracticeMetrics {
  drillType: DrillType;
  targetsTotal: number;
  targetsDone: number;
  dartsThrown: number;
  successRate?: number;
  avgDartsPerSuccess?: number;
  threeDartAvg?: number;
  lifetimeAvg?: number;
  elapsedMs?: number;
  perDouble?: Record<string, { hits: number; attempts: number }>;
}

export interface TurnInput {
  darts?: string[];
  scoreTotal?: number;
}

export interface TurnOutcome {
  resultsToAppend: PracticeResult[];
  advanced: boolean;
  finished: boolean;
  currentIndex: number;
  currentTargetDarts: number;
  totalSuccesses: number;
  scoringTotal: number;
  dartsThrown: number;
}

const DIFFICULTY_RANGES: Record<Difficulty, [number, number]> = {
  easy: [2, 40],
  medium: [41, 100],
  hard: [101, 170],
};

const ATB_TOTAL = 21;
const DRILL_TARGET_COUNT = 10;
const DOUBLES_DART_BUDGET = 9;

/** S/D/T+num → num; SB/DB → 'bull'; '0' and invalid → null. */
function dartSegment(dart: string): number | 'bull' | null {
  if (dart === 'SB' || dart === 'DB') return 'bull';
  if (dart === '0') return null;
  const m = /^[STD]([1-9]|1[0-9]|20)$/.exec(dart);
  if (!m) return null;
  return parseInt(m[1]!, 10);
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function isDouble(dart: string): boolean {
  return dart === 'DB' || /^D([1-9]|1[0-9]|20)$/.test(dart);
}

export function generateTargets(drillType: DrillType, difficulty?: Difficulty): PracticeTarget[] {
  switch (drillType) {
    case 'checkout': {
      const [lo, hi] = DIFFICULTY_RANGES[difficulty ?? 'medium'];
      const candidates = Object.keys(checkouts)
        .map(Number)
        .filter((s) => s >= lo && s <= hi);
      const picked = shuffle(candidates).slice(0, DRILL_TARGET_COUNT);
      picked.sort((a, b) => a - b);
      return picked.map((score) => ({ label: String(score), hint: checkouts[score] }));
    }
    case 'scoring':
      return Array.from({ length: DRILL_TARGET_COUNT }, (_, i) => ({ label: `Round ${i + 1}` }));
    case 'around_the_clock':
      return [
        ...Array.from({ length: 20 }, (_, i) => ({ label: String(i + 1) })),
        { label: 'Bull' },
      ];
    case 'doubles': {
      const pool = [
        ...Array.from({ length: 20 }, (_, i) => `D${i + 1}`),
        'DB',
      ];
      return shuffle(pool)
        .slice(0, DRILL_TARGET_COUNT)
        .map((d) => ({ label: d === 'DB' ? 'Bull' : d }));
    }
  }
}

/** The exact dart string a doubles target expects ("Bull" → "DB", "D16" → "D16"). */
function doublesTargetDart(label: string): string {
  return label === 'Bull' ? 'DB' : label;
}

function applyCheckoutTurn(session: PracticeSessionRow, darts: string[], targets: PracticeTarget[]): TurnOutcome {
  const target = targets[session.current_index]!;
  const score = parseInt(target.label, 10);
  const scored = darts.reduce((s, d) => s + parseDartScore(d), 0);
  const remaining = score - scored;
  const last = darts[darts.length - 1];
  const finishedOnDouble = remaining === 0 && !!last && isDouble(last);
  const success = finishedOnDouble;
  const detail = `${score} → ${Math.max(remaining, 0)}`;
  return {
    resultsToAppend: [{
      targetIndex: session.current_index,
      label: target.label,
      success,
      dartsUsed: darts.length,
      detail,
    }],
    advanced: true,
    finished: session.current_index + 1 >= targets.length,
    currentIndex: session.current_index + 1,
    currentTargetDarts: 0,
    totalSuccesses: session.total_successes + (success ? 1 : 0),
    scoringTotal: session.scoring_total,
    dartsThrown: session.darts_thrown + darts.length,
  };
}

function applyScoringTurn(session: PracticeSessionRow, scoreTotal: number, targets: PracticeTarget[]): TurnOutcome {
  const target = targets[session.current_index]!;
  return {
    resultsToAppend: [{
      targetIndex: session.current_index,
      label: target.label,
      success: true,
      dartsUsed: 3,
      detail: String(scoreTotal),
      scoreValue: scoreTotal,
    }],
    advanced: true,
    finished: session.current_index + 1 >= targets.length,
    currentIndex: session.current_index + 1,
    currentTargetDarts: 0,
    totalSuccesses: session.total_successes,
    scoringTotal: session.scoring_total + scoreTotal,
    dartsThrown: session.darts_thrown + 3,
  };
}

function applyAtbTurn(session: PracticeSessionRow, darts: string[], targets: PracticeTarget[]): TurnOutcome {
  const results: PracticeResult[] = [];
  let index = session.current_index;
  let successes = session.total_successes;
  for (const dart of darts) {
    if (index >= ATB_TOTAL) break;
    const target = targets[index]!;
    const seg = dartSegment(dart);
    const hit = target.label === 'Bull' ? seg === 'bull' : seg === parseInt(target.label, 10);
    if (hit) {
      results.push({
        targetIndex: index,
        label: target.label,
        success: true,
        dartsUsed: 1,
        detail: dart,
      });
      index++;
      successes++;
    }
  }
  return {
    resultsToAppend: results,
    advanced: index !== session.current_index,
    finished: index >= ATB_TOTAL,
    currentIndex: index,
    currentTargetDarts: 0,
    totalSuccesses: successes,
    scoringTotal: session.scoring_total,
    dartsThrown: session.darts_thrown + darts.length,
  };
}

function applyDoublesTurn(session: PracticeSessionRow, darts: string[], targets: PracticeTarget[]): TurnOutcome {
  const target = targets[session.current_index]!;
  const wanted = doublesTargetDart(target.label);
  const dartsAfter = session.current_target_darts + darts.length;
  const hit = darts.includes(wanted);

  if (hit) {
    const hitDartIndex = darts.indexOf(wanted) + 1;
    return {
      resultsToAppend: [{
        targetIndex: session.current_index,
        label: target.label,
        success: true,
        dartsUsed: session.current_target_darts + hitDartIndex,
        detail: `${target.label} hit`,
      }],
      advanced: true,
      finished: session.current_index + 1 >= targets.length,
      currentIndex: session.current_index + 1,
      currentTargetDarts: 0,
      totalSuccesses: session.total_successes + 1,
      scoringTotal: session.scoring_total,
      dartsThrown: session.darts_thrown + darts.length,
    };
  }

  if (dartsAfter >= DOUBLES_DART_BUDGET) {
    return {
      resultsToAppend: [{
        targetIndex: session.current_index,
        label: target.label,
        success: false,
        dartsUsed: dartsAfter,
        detail: `${target.label} missed`,
      }],
      advanced: true,
      finished: session.current_index + 1 >= targets.length,
      currentIndex: session.current_index + 1,
      currentTargetDarts: 0,
      totalSuccesses: session.total_successes,
      scoringTotal: session.scoring_total,
      dartsThrown: session.darts_thrown + darts.length,
    };
  }

  return {
    resultsToAppend: [],
    advanced: false,
    finished: false,
    currentIndex: session.current_index,
    currentTargetDarts: dartsAfter,
    totalSuccesses: session.total_successes,
    scoringTotal: session.scoring_total,
    dartsThrown: session.darts_thrown + darts.length,
  };
}

export function applyTurn(session: PracticeSessionRow, input: TurnInput): TurnOutcome {
  const targets = JSON.parse(session.targets_json) as PracticeTarget[];
  const darts = input.darts ?? [];
  switch (session.drill_type) {
    case 'checkout':
      return applyCheckoutTurn(session, darts, targets);
    case 'scoring':
      return applyScoringTurn(session, input.scoreTotal ?? 0, targets);
    case 'around_the_clock':
      return applyAtbTurn(session, darts, targets);
    case 'doubles':
      return applyDoublesTurn(session, darts, targets);
  }
}

export function computeMetrics(session: PracticeSessionRow): PracticeMetrics {
  const targets = JSON.parse(session.targets_json) as PracticeTarget[];
  const results = JSON.parse(session.results_json) as PracticeResult[];
  const targetsDone = session.current_index;

  const metrics: PracticeMetrics = {
    drillType: session.drill_type,
    targetsTotal: targets.length,
    targetsDone,
    dartsThrown: session.darts_thrown,
  };

  switch (session.drill_type) {
    case 'checkout': {
      metrics.successRate = targetsDone > 0 ? session.total_successes / targetsDone : 0;
      const successes = results.filter((r) => r.success);
      const dartsOnSuccess = successes.reduce((s, r) => s + r.dartsUsed, 0);
      metrics.avgDartsPerSuccess = successes.length > 0 ? dartsOnSuccess / successes.length : 0;
      break;
    }
    case 'scoring': {
      metrics.threeDartAvg = targetsDone > 0 ? session.scoring_total / targetsDone : 0;
      break;
    }
    case 'around_the_clock': {
      const start = Date.parse(session.started_at.replace(' ', 'T') + 'Z');
      const end = session.finished_at
        ? Date.parse(session.finished_at.replace(' ', 'T') + 'Z')
        : Date.now();
      metrics.elapsedMs = Number.isFinite(start) ? Math.max(0, end - start) : 0;
      break;
    }
    case 'doubles': {
      metrics.successRate = targetsDone > 0 ? session.total_successes / targetsDone : 0;
      const successes = results.filter((r) => r.success);
      const dartsOnSuccess = successes.reduce((s, r) => s + r.dartsUsed, 0);
      metrics.avgDartsPerSuccess = successes.length > 0 ? dartsOnSuccess / successes.length : 0;
      const perDouble: Record<string, { hits: number; attempts: number }> = {};
      for (const r of results) {
        const entry = perDouble[r.label] ?? { hits: 0, attempts: 0 };
        entry.attempts += 1;
        if (r.success) entry.hits += 1;
        perDouble[r.label] = entry;
      }
      metrics.perDouble = perDouble;
      break;
    }
  }

  return metrics;
}

export function summaryMetricsForHistory(session: PracticeSessionRow): { metric_name: string; metric_value: number }[] {
  const m = computeMetrics(session);
  const out: { metric_name: string; metric_value: number }[] = [];
  switch (session.drill_type) {
    case 'checkout':
      out.push({ metric_name: 'successRate', metric_value: m.successRate ?? 0 });
      out.push({ metric_name: 'avgDartsPerSuccess', metric_value: m.avgDartsPerSuccess ?? 0 });
      break;
    case 'scoring':
      out.push({ metric_name: 'threeDartAvg', metric_value: m.threeDartAvg ?? 0 });
      break;
    case 'around_the_clock':
      out.push({ metric_name: 'elapsedMs', metric_value: m.elapsedMs ?? 0 });
      out.push({ metric_name: 'dartsThrown', metric_value: m.dartsThrown });
      break;
    case 'doubles':
      out.push({ metric_name: 'successRate', metric_value: m.successRate ?? 0 });
      out.push({ metric_name: 'avgDartsPerSuccess', metric_value: m.avgDartsPerSuccess ?? 0 });
      break;
  }
  return out;
}

export { isValidDart };
