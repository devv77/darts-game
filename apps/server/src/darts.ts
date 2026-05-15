export function parseDartScore(dart: string | null | undefined): number {
  if (!dart || dart === '0') return 0;
  if (dart === 'SB') return 25;
  if (dart === 'DB') return 50;
  const prefix = dart[0];
  const num = parseInt(dart.slice(1), 10);
  if (isNaN(num)) return 0;
  if (prefix === 'S') return num;
  if (prefix === 'D') return num * 2;
  if (prefix === 'T') return num * 3;
  return 0;
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
