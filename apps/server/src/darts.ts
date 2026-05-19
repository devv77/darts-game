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
