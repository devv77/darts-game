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

export function formatDart(dart: string | null | undefined): string {
  if (!dart || dart === '0') return 'Miss';
  if (dart === 'SB') return '25';
  if (dart === 'DB') return 'Bull';
  const prefix = dart[0];
  const num = dart.slice(1);
  if (prefix === 'S') return num;
  if (prefix === 'D') return 'D' + num;
  if (prefix === 'T') return 'T' + num;
  return dart;
}

export type VisitState = 'open' | 'checkout' | 'bust';

/**
 * Where a (partial) X01 visit stands after these darts — mirrors the server's
 * scoreX01Visit. Once it's 'checkout' or 'bust' the visit is over: no more darts.
 */
export function x01VisitState(startScore: number, darts: string[], doubleOut: boolean): VisitState {
  let left = startScore;
  for (const dart of darts) {
    left -= parseDartScore(dart);
    const bust = doubleOut
      ? left < 0 || left === 1 || (left === 0 && !dart.startsWith('D'))
      : left < 0;
    if (bust) return 'bust';
    if (left === 0) return 'checkout';
  }
  return 'open';
}
