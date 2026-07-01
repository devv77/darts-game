export function parseDartScore(dart: string | null | undefined): number {
  if (!dart || dart === '0') return 0;
  if (dart === 'SB') return 25;
  if (dart === 'DB') return 50;
  const m = /^([STD])([1-9]|1[0-9]|20)$/.exec(dart);
  if (!m) return 0;
  const num = parseInt(m[2]!, 10);
  if (m[1] === 'S') return num;
  if (m[1] === 'D') return num * 2;
  return num * 3;
}

/** Strict dart-string validity check. `0`/`SB`/`DB`/`S1`..`S20`/`D1`..`D20`/`T1`..`T20`. */
export function isValidDart(dart: string | null | undefined): boolean {
  if (dart === '0' || dart === 'SB' || dart === 'DB') return true;
  if (typeof dart !== 'string') return false;
  return /^[STD]([1-9]|1[0-9]|20)$/.test(dart);
}

/** Around-the-Clock: total targets to clear — numbers 1..20 then the bull. */
export const ATC_TARGET_COUNT = 21;

/** The number a player on `hits` cleared targets is aiming: 1..20, or 21 = bull. */
export function atcTarget(hits: number): number {
  return hits + 1; // hits 0..19 → 1..20; hits 20 → 21 (bull)
}

/**
 * Apply one dart to an Around-the-Clock progress count and return the new count.
 *
 * - Targets are cleared strictly in order 1..20 then the bull (hits 20 → 21).
 * - `single` mode: only an exact single of the current number advances (+1);
 *   doubles/trebles never count. The bull is cleared by SB or DB.
 * - `multiplier` mode: on the current number a single advances +1, a double +2,
 *   a treble +3 (a treble can leapfrog past later numbers / the bull to finish).
 *   The bull is still cleared by SB or DB.
 */
export function applyAtcDart(hits: number, dart: string | null | undefined, advance: 'single' | 'multiplier'): number {
  if (hits >= ATC_TARGET_COUNT || !dart || dart === '0') return hits;
  const target = atcTarget(hits);
  if (target === ATC_TARGET_COUNT) {
    return dart === 'SB' || dart === 'DB' ? ATC_TARGET_COUNT : hits;
  }
  const m = /^([SDT])([1-9]|1[0-9]|20)$/.exec(dart);
  if (!m || parseInt(m[2]!, 10) !== target) return hits;
  if (advance === 'single') return m[1] === 'S' ? hits + 1 : hits;
  const step = m[1] === 'S' ? 1 : m[1] === 'D' ? 2 : 3;
  return Math.min(ATC_TARGET_COUNT, hits + step);
}

export interface CricketDartInfo {
  number: number | 'bull' | null;
  multiplier: number;
}

export function parseCricketDart(dart: string | null | undefined): CricketDartInfo {
  if (!dart || dart === '0') return { number: null, multiplier: 0 };
  if (dart === 'SB') return { number: 'bull', multiplier: 1 };
  if (dart === 'DB') return { number: 'bull', multiplier: 2 };
  const prefix = dart[0];
  const num = parseInt(dart.slice(1), 10);
  if (isNaN(num) || num < 15 || num > 20) return { number: null, multiplier: 0 };
  const mult = prefix === 'S' ? 1 : prefix === 'D' ? 2 : prefix === 'T' ? 3 : 0;
  return { number: num, multiplier: mult };
}
