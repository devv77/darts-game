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
