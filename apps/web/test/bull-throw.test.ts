import { describe, expect, it } from 'vitest';
import {
  meanDistanceForLevel,
  simulateAiDistance,
  sortByDistance,
  type BullThrowResult,
} from '../src/lib/bull-throw';

describe('bull-throw / sortByDistance', () => {
  it('orders results by ascending distance', () => {
    const input: BullThrowResult[] = [
      { playerId: 10, distanceMm: 42.5 },
      { playerId: 11, distanceMm: 4.2 },
      { playerId: 12, distanceMm: 18.7 },
      { playerId: 13, distanceMm: 30.1 },
    ];
    const sorted = sortByDistance(input);
    expect(sorted.map((r) => r.playerId)).toEqual([11, 12, 13, 10]);
    expect(sorted.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('does not mutate the input array', () => {
    const input: BullThrowResult[] = [
      { playerId: 1, distanceMm: 9 },
      { playerId: 2, distanceMm: 3 },
    ];
    const snapshot = JSON.stringify(input);
    sortByDistance(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  it('breaks ties by preserving input order (stable enough for ranking)', () => {
    const input: BullThrowResult[] = [
      { playerId: 1, distanceMm: 10 },
      { playerId: 2, distanceMm: 10 },
    ];
    const sorted = sortByDistance(input);
    expect(sorted[0]!.rank).toBe(1);
    expect(sorted[1]!.rank).toBe(2);
  });
});

describe('bull-throw / meanDistanceForLevel', () => {
  it('returns ~5mm for level 10 and ~50mm for level 1', () => {
    expect(meanDistanceForLevel(10)).toBeCloseTo(5, 5);
    expect(meanDistanceForLevel(1)).toBeCloseTo(50, 5);
  });

  it('is monotonically decreasing across levels', () => {
    const means = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(meanDistanceForLevel);
    for (let i = 1; i < means.length; i++) {
      expect(means[i]!).toBeLessThan(means[i - 1]!);
    }
  });

  it('clamps out-of-range levels', () => {
    expect(meanDistanceForLevel(0)).toBe(meanDistanceForLevel(1));
    expect(meanDistanceForLevel(99)).toBe(meanDistanceForLevel(10));
  });
});

describe('bull-throw / simulateAiDistance', () => {
  it('produces non-negative distances', () => {
    for (let i = 0; i < 200; i++) {
      expect(simulateAiDistance(5)).toBeGreaterThanOrEqual(0);
    }
  });

  it('Lv.10 averages closer to bull than Lv.1 across many samples', () => {
    const N = 1000;
    let sum10 = 0;
    let sum1 = 0;
    for (let i = 0; i < N; i++) {
      sum10 += simulateAiDistance(10);
      sum1 += simulateAiDistance(1);
    }
    const avg10 = sum10 / N;
    const avg1 = sum1 / N;
    expect(avg10).toBeLessThan(avg1);
    // Sanity: Lv.10 mean ought to be well under Lv.1 mean
    expect(avg10).toBeLessThan(avg1 / 2);
  });
});
