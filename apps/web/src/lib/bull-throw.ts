export interface BullThrowResult {
  playerId: number;
  distanceMm: number;
}

export interface SortedBullThrowResult extends BullThrowResult {
  rank: number;
}

const HUMAN_LEVEL_EQUIVALENT = 5;

// WHY: Box-Muller — gives normally-distributed noise so the tail of misses looks
// real (most darts cluster near the mean radius for the level, with rare flyers).
function gaussian(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

export function meanDistanceForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(10, level));
  // Linear ramp: Lv.10 -> 5mm, Lv.1 -> 50mm
  return 50 - ((clamped - 1) / 9) * 45;
}

export function simulateAiDistance(level: number, rng: () => number = Math.random): number {
  const mean = meanDistanceForLevel(level);
  // WHY: sigma scales with the mean so a beginner has both a wider spread and a
  // higher floor — Lv.10's noise stays tight around the bull.
  const sigma = mean * 0.6;
  const raw = mean + gaussian(rng) * sigma;
  return Math.max(0, raw);
}

export function simulateHumanDistance(rng: () => number = Math.random): number {
  return simulateAiDistance(HUMAN_LEVEL_EQUIVALENT, rng);
}

export function sortByDistance(results: BullThrowResult[]): SortedBullThrowResult[] {
  return [...results]
    .sort((a, b) => a.distanceMm - b.distanceMm)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}
