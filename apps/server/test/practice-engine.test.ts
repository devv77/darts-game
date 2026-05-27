import { describe, it, expect } from 'vitest';
import {
  generateTargets,
  applyTurn,
  computeMetrics,
  type PracticeTarget,
  type PracticeResult,
} from '../src/practice-engine.js';
import type { DrillType, Difficulty, PracticeSessionRow } from '../src/types.js';

function makeRow(
  drillType: DrillType,
  targets: PracticeTarget[],
  overrides: Partial<PracticeSessionRow> = {},
): PracticeSessionRow {
  return {
    id: 1,
    player_id: 1,
    drill_type: drillType,
    difficulty: overrides.difficulty ?? null,
    targets_json: JSON.stringify(targets),
    results_json: overrides.results_json ?? '[]',
    current_index: overrides.current_index ?? 0,
    current_target_darts: overrides.current_target_darts ?? 0,
    total_successes: overrides.total_successes ?? 0,
    scoring_total: overrides.scoring_total ?? 0,
    darts_thrown: overrides.darts_thrown ?? 0,
    started_at: overrides.started_at ?? '2026-05-27 12:00:00',
    finished_at: overrides.finished_at ?? null,
  };
}

describe('generateTargets', () => {
  it('checkout: 10 distinct targets within the difficulty range, with hints', () => {
    const ranges: Record<Difficulty, [number, number]> = {
      easy: [2, 40],
      medium: [41, 100],
      hard: [101, 170],
    };
    for (const diff of ['easy', 'medium', 'hard'] as Difficulty[]) {
      const targets = generateTargets('checkout', diff);
      expect(targets).toHaveLength(10);
      const scores = targets.map((t) => parseInt(t.label, 10));
      expect(new Set(scores).size).toBe(10);
      const [lo, hi] = ranges[diff];
      for (const t of targets) {
        const score = parseInt(t.label, 10);
        expect(score).toBeGreaterThanOrEqual(lo);
        expect(score).toBeLessThanOrEqual(hi);
        expect(typeof t.hint).toBe('string');
        expect(t.hint!.length).toBeGreaterThan(0);
      }
    }
  });

  it('checkout: defaults to medium range when no difficulty given', () => {
    const targets = generateTargets('checkout');
    for (const t of targets) {
      const score = parseInt(t.label, 10);
      expect(score).toBeGreaterThanOrEqual(41);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it('scoring: 10 labelled rounds', () => {
    const targets = generateTargets('scoring');
    expect(targets).toHaveLength(10);
    expect(targets[0]!.label).toBe('Round 1');
    expect(targets[9]!.label).toBe('Round 10');
  });

  it('around_the_clock: 1..20 then Bull (21 targets)', () => {
    const targets = generateTargets('around_the_clock');
    expect(targets).toHaveLength(21);
    expect(targets[0]!.label).toBe('1');
    expect(targets[19]!.label).toBe('20');
    expect(targets[20]!.label).toBe('Bull');
  });

  it('doubles: 10 distinct doubles from D1..D20 + Bull', () => {
    const targets = generateTargets('doubles');
    expect(targets).toHaveLength(10);
    const labels = targets.map((t) => t.label);
    expect(new Set(labels).size).toBe(10);
    for (const l of labels) {
      expect(l === 'Bull' || /^D([1-9]|1[0-9]|20)$/.test(l)).toBe(true);
    }
  });
});

describe('checkout drill', () => {
  it('records a success when the score is finished on a double', () => {
    const targets: PracticeTarget[] = [{ label: '81', hint: 'T19 D12' }];
    const row = makeRow('checkout', targets);
    const out = applyTurn(row, { darts: ['T19', 'D12'] });
    expect(out.finished).toBe(true);
    expect(out.advanced).toBe(true);
    expect(out.totalSuccesses).toBe(1);
    expect(out.dartsThrown).toBe(2);
    const r = out.resultsToAppend[0]!;
    expect(r.success).toBe(true);
    expect(r.dartsUsed).toBe(2);
    expect(r.detail).toBe('81 → 0');
  });

  it('records a bust (no double finish) and still advances', () => {
    const targets: PracticeTarget[] = [{ label: '81', hint: 'T19 D12' }, { label: '40', hint: 'D20' }];
    const row = makeRow('checkout', targets);
    const out = applyTurn(row, { darts: ['T19', 'S24' as string, '0'] });
    expect(out.advanced).toBe(true);
    expect(out.finished).toBe(false);
    expect(out.totalSuccesses).toBe(0);
    expect(out.currentIndex).toBe(1);
    expect(out.resultsToAppend[0]!.success).toBe(false);
  });

  it('bust when busting below zero', () => {
    const targets: PracticeTarget[] = [{ label: '40', hint: 'D20' }];
    const row = makeRow('checkout', targets);
    const out = applyTurn(row, { darts: ['T20'] });
    expect(out.resultsToAppend[0]!.success).toBe(false);
    expect(out.resultsToAppend[0]!.detail).toBe('40 → 0');
  });
});

describe('scoring drill', () => {
  it('accumulates score and computes the three-dart average', () => {
    const targets = generateTargets('scoring');
    let row = makeRow('scoring', targets);
    const rounds = [60, 100, 140, 45, 26, 81, 100, 60, 41, 95];
    for (const score of rounds) {
      const out = applyTurn(row, { scoreTotal: score });
      row = makeRow('scoring', targets, {
        results_json: JSON.stringify([
          ...(JSON.parse(row.results_json) as PracticeResult[]),
          ...out.resultsToAppend,
        ]),
        current_index: out.currentIndex,
        scoring_total: out.scoringTotal,
        darts_thrown: out.dartsThrown,
        finished_at: out.finished ? '2026-05-27 12:05:00' : null,
      });
    }
    const total = rounds.reduce((a, b) => a + b, 0);
    const metrics = computeMetrics(row);
    expect(metrics.targetsDone).toBe(10);
    expect(metrics.dartsThrown).toBe(30);
    expect(metrics.threeDartAvg).toBeCloseTo(total / 10, 6);
  });
});

describe('around_the_clock drill', () => {
  it('advances multiple targets within a single 3-dart turn', () => {
    const targets = generateTargets('around_the_clock');
    const row = makeRow('around_the_clock', targets);
    const out = applyTurn(row, { darts: ['S1', 'T2', 'D3'] });
    expect(out.currentIndex).toBe(3);
    expect(out.advanced).toBe(true);
    expect(out.totalSuccesses).toBe(3);
    expect(out.dartsThrown).toBe(3);
    expect(out.resultsToAppend.map((r) => r.label)).toEqual(['1', '2', '3']);
  });

  it('non-matching darts count toward darts thrown but do not advance', () => {
    const targets = generateTargets('around_the_clock');
    const row = makeRow('around_the_clock', targets);
    const out = applyTurn(row, { darts: ['S5', 'S5', 'S1'] });
    expect(out.currentIndex).toBe(1);
    expect(out.dartsThrown).toBe(3);
    expect(out.resultsToAppend).toHaveLength(1);
  });

  it('finishes once Bull (target 21) is hit', () => {
    const targets = generateTargets('around_the_clock');
    const row = makeRow('around_the_clock', targets, { current_index: 20, total_successes: 20 });
    const out = applyTurn(row, { darts: ['DB'] });
    expect(out.finished).toBe(true);
    expect(out.currentIndex).toBe(21);
  });
});

describe('doubles drill', () => {
  it('records a hit and advances when the target double is thrown', () => {
    const targets: PracticeTarget[] = [{ label: 'D16' }, { label: 'D20' }];
    const row = makeRow('doubles', targets);
    const out = applyTurn(row, { darts: ['S16', 'D16', '0'] });
    expect(out.advanced).toBe(true);
    expect(out.totalSuccesses).toBe(1);
    expect(out.currentIndex).toBe(1);
    expect(out.resultsToAppend[0]!.success).toBe(true);
  });

  it('records a miss after 9 darts with no hit', () => {
    const targets: PracticeTarget[] = [{ label: 'D16' }, { label: 'D20' }];
    const miss = ['S16', 'S16', 'S16'];

    let row = makeRow('doubles', targets);
    const t1 = applyTurn(row, { darts: miss });
    expect(t1.advanced).toBe(false);
    expect(t1.currentTargetDarts).toBe(3);

    row = makeRow('doubles', targets, { current_target_darts: t1.currentTargetDarts, darts_thrown: t1.dartsThrown });
    const t2 = applyTurn(row, { darts: miss });
    expect(t2.advanced).toBe(false);
    expect(t2.currentTargetDarts).toBe(6);

    row = makeRow('doubles', targets, { current_target_darts: t2.currentTargetDarts, darts_thrown: t2.dartsThrown });
    const t3 = applyTurn(row, { darts: miss });
    expect(t3.advanced).toBe(true);
    expect(t3.totalSuccesses).toBe(0);
    expect(t3.currentIndex).toBe(1);
    expect(t3.resultsToAppend[0]!.success).toBe(false);
    expect(t3.resultsToAppend[0]!.dartsUsed).toBe(9);
  });

  it('builds a perDouble heatmap in metrics', () => {
    const targets: PracticeTarget[] = [{ label: 'D16' }, { label: 'D20' }];
    const results: PracticeResult[] = [
      { targetIndex: 0, label: 'D16', success: true, dartsUsed: 2 },
      { targetIndex: 1, label: 'D20', success: false, dartsUsed: 9 },
    ];
    const row = makeRow('doubles', targets, {
      results_json: JSON.stringify(results),
      current_index: 2,
      total_successes: 1,
      darts_thrown: 11,
      finished_at: '2026-05-27 12:05:00',
    });
    const metrics = computeMetrics(row);
    expect(metrics.successRate).toBeCloseTo(0.5, 6);
    expect(metrics.perDouble!['D16']).toEqual({ hits: 1, attempts: 1 });
    expect(metrics.perDouble!['D20']).toEqual({ hits: 0, attempts: 1 });
  });
});
