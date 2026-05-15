import { getCheckout } from './checkout-table.js';
import { parseDartScore } from './darts.js';
import type { FullGameState, GameMode } from './types.js';

const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

interface LevelParams {
  name: string;
  targetAcc: number;
  trebleRate: number;
  doubleRate: number;
  missRate: number;
  scatter: number;
}

export const LEVEL_PARAMS: Record<number, LevelParams> = {
  1: { name: 'Beginner', targetAcc: 0.20, trebleRate: 0.03, doubleRate: 0.05, missRate: 0.25, scatter: 3 },
  2: { name: 'Novice', targetAcc: 0.28, trebleRate: 0.05, doubleRate: 0.10, missRate: 0.20, scatter: 3 },
  3: { name: 'Casual', targetAcc: 0.36, trebleRate: 0.10, doubleRate: 0.15, missRate: 0.15, scatter: 2 },
  4: { name: 'Pub Player', targetAcc: 0.44, trebleRate: 0.15, doubleRate: 0.20, missRate: 0.12, scatter: 2 },
  5: { name: 'Club Player', targetAcc: 0.52, trebleRate: 0.22, doubleRate: 0.28, missRate: 0.09, scatter: 2 },
  6: { name: 'League', targetAcc: 0.60, trebleRate: 0.30, doubleRate: 0.35, missRate: 0.07, scatter: 1 },
  7: { name: 'County', targetAcc: 0.68, trebleRate: 0.38, doubleRate: 0.42, missRate: 0.05, scatter: 1 },
  8: { name: 'Semi-Pro', targetAcc: 0.76, trebleRate: 0.46, doubleRate: 0.52, missRate: 0.03, scatter: 1 },
  9: { name: 'Pro', targetAcc: 0.85, trebleRate: 0.55, doubleRate: 0.62, missRate: 0.02, scatter: 1 },
  10: { name: 'World Class', targetAcc: 0.93, trebleRate: 0.65, doubleRate: 0.75, missRate: 0.01, scatter: 1 },
};

type Target = { segment: number | 'bull'; ring: 'S' | 'D' | 'T' | 'SB' | 'DB' };

function getAdjacentSegment(segment: number, offset: number): number {
  const idx = BOARD_ORDER.indexOf(segment);
  if (idx === -1) return segment;
  const newIdx = ((idx + offset) % 20 + 20) % 20;
  return BOARD_ORDER[newIdx]!;
}

function scatterSegment(segment: number, scatterRange: number): number {
  const offset = Math.floor(Math.random() * (scatterRange * 2 + 1)) - scatterRange;
  return getAdjacentSegment(segment, offset);
}

function roll(probability: number): boolean {
  return Math.random() < probability;
}

function throwDart(params: LevelParams, target: Target): string {
  if (roll(params.missRate)) return '0';

  if (target.segment === 'bull') {
    if (target.ring === 'DB') {
      if (roll(params.doubleRate)) return 'DB';
      if (roll(params.targetAcc * 0.5)) return 'SB';
      const seg = BOARD_ORDER[Math.floor(Math.random() * 20)]!;
      return 'S' + seg;
    }
    if (roll(params.targetAcc)) return 'SB';
    if (roll(0.08)) return 'DB';
    const seg = BOARD_ORDER[Math.floor(Math.random() * 20)]!;
    return 'S' + seg;
  }

  const seg = target.segment as number;

  if (target.ring === 'T') {
    if (roll(params.trebleRate)) return 'T' + seg;
    if (roll(params.targetAcc)) return 'S' + seg;
    const scattered = scatterSegment(seg, params.scatter);
    if (roll(0.05)) return 'T' + scattered;
    if (roll(0.05)) return 'D' + scattered;
    return 'S' + scattered;
  }

  if (target.ring === 'D') {
    if (roll(params.doubleRate)) return 'D' + seg;
    if (roll(params.targetAcc * 0.6)) return 'S' + seg;
    if (roll(0.30)) return '0';
    const scattered = scatterSegment(seg, params.scatter);
    return 'S' + scattered;
  }

  if (roll(params.targetAcc)) return 'S' + seg;
  const scattered = scatterSegment(seg, params.scatter);
  if (roll(0.05)) return 'T' + scattered;
  if (roll(0.04)) return 'D' + scattered;
  return 'S' + scattered;
}

function parseCheckoutTargets(checkoutStr: string | null): Target[] | null {
  if (!checkoutStr) return null;
  return checkoutStr.split(' ').map((d) => {
    if (d === 'DB') return { segment: 'bull', ring: 'DB' };
    if (d === 'SB') return { segment: 'bull', ring: 'SB' };
    const ring = d[0] as 'S' | 'D' | 'T';
    const seg = parseInt(d.slice(1), 10);
    return { segment: seg, ring };
  });
}

function pickX01Target(level: number, remainingScore: number, dartsLeft: number): Target {
  const checkoutStr = getCheckout(remainingScore);
  if (checkoutStr) {
    const targets = parseCheckoutTargets(checkoutStr);
    if (targets && targets.length <= dartsLeft) {
      const checkoutThreshold = level <= 3 ? 40 : level <= 6 ? 120 : 170;
      if (remainingScore <= checkoutThreshold) {
        return targets[0]!;
      }
    }
  }

  if (remainingScore <= 40 && remainingScore % 2 === 0) {
    return { segment: remainingScore / 2, ring: 'D' };
  }
  if (remainingScore <= 40 && remainingScore % 2 === 1) {
    return { segment: 1, ring: 'S' };
  }

  if (level <= 3) {
    return { segment: 20, ring: 'S' };
  }
  return { segment: 20, ring: 'T' };
}

function generateX01Turn(level: number, currentScore: number): string[] {
  const params = LEVEL_PARAMS[level]!;
  const darts: string[] = [];
  let remaining = currentScore;

  for (let i = 0; i < 3; i++) {
    const dartsLeft = 3 - i;
    let target = pickX01Target(level, remaining, dartsLeft);

    const checkoutStr = getCheckout(remaining);
    if (checkoutStr) {
      const targets = parseCheckoutTargets(checkoutStr);
      const checkoutThreshold = level <= 3 ? 40 : level <= 6 ? 120 : 170;
      if (targets && targets.length <= dartsLeft && remaining <= checkoutThreshold) {
        target = targets[0]!;
      }
    }

    const dart = throwDart(params, target);
    const dartScore = parseDartScore(dart);
    const newRemaining = remaining - dartScore;

    darts.push(dart);

    if (newRemaining < 0 || newRemaining === 1) break;
    if (newRemaining === 0) {
      if (!dart.startsWith('D') && dart !== 'DB') break;
      break;
    }
    remaining = newRemaining;
  }

  return darts;
}

const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15];

type MarkKey = 15 | 16 | 17 | 18 | 19 | 20 | 'bull';
type PendingMarks = Record<MarkKey, number>;

function findScorableNumbers(
  closedNumbers: MarkKey[],
  opponentCSList: Record<string, number>[]
): MarkKey[] {
  return closedNumbers
    .filter((n) => {
      const col = n === 'bull' ? 'marks_bull' : `marks_${n}`;
      return !opponentCSList.every((os) => (os[col] ?? 0) >= 3);
    })
    .sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
}

function makeTarget(num: MarkKey, ring: 'S' | 'D' | 'T'): Target {
  if (num === 'bull') {
    return { segment: 'bull', ring: ring === 'T' || ring === 'D' ? 'DB' : 'SB' };
  }
  return { segment: num, ring };
}

function pickCricketTarget(
  level: number,
  pendingMarks: PendingMarks,
  opponentCSList: Record<string, number>[]
): Target {
  const allNumbers: MarkKey[] = [...CRICKET_NUMBERS, 'bull' as const] as MarkKey[];
  const unclosed = allNumbers.filter((n) => pendingMarks[n] < 3);
  const closed = allNumbers.filter((n) => pendingMarks[n] >= 3);

  if (level <= 3) {
    if (unclosed.length === 0) {
      const scorable = findScorableNumbers(closed, opponentCSList);
      if (scorable.length > 0) {
        const num = scorable[Math.floor(Math.random() * scorable.length)]!;
        return makeTarget(num, level <= 1 ? 'S' : (roll(0.3) ? 'T' : 'S'));
      }
      return { segment: 20, ring: 'S' };
    }
    const num = unclosed[Math.floor(Math.random() * unclosed.length)]!;
    const ring = level <= 1 ? 'S' : (roll(0.25) ? 'T' : 'S');
    return makeTarget(num, ring);
  }

  if (level <= 6) {
    if (unclosed.length === 0) {
      const scorable = findScorableNumbers(closed, opponentCSList);
      if (scorable.length > 0) return makeTarget(scorable[0]!, 'T');
      return { segment: 20, ring: 'T' };
    }
    const sorted = unclosed.slice().sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0]!, 'T');
  }

  const scorable = findScorableNumbers(closed, opponentCSList);

  const threatened = unclosed.filter((n) => {
    const col = n === 'bull' ? 'marks_bull' : `marks_${n}`;
    return opponentCSList.some((os) => (os[col] ?? 0) >= 2);
  });

  const almostClosed = unclosed
    .filter((n) => pendingMarks[n] >= 1)
    .sort((a, b) => pendingMarks[b] - pendingMarks[a]);

  if (threatened.length > 0 && roll(0.6)) {
    const sorted = threatened.slice().sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0]!, 'T');
  }

  if (almostClosed.length > 0 && roll(0.5)) {
    return makeTarget(almostClosed[0]!, 'T');
  }

  if (scorable.length > 0 && unclosed.length <= 2 && roll(0.4)) {
    const best = scorable.slice().sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(best[0]!, 'T');
  }

  if (unclosed.length > 0) {
    const sorted = unclosed.slice().sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0]!, 'T');
  }

  if (scorable.length > 0) return makeTarget(scorable[0]!, 'T');

  return { segment: 20, ring: 'T' };
}

function parseCricketDartInfo(dart: string): { number: MarkKey | null; multiplier: number } {
  if (!dart || dart === '0') return { number: null, multiplier: 0 };
  if (dart === 'SB') return { number: 'bull', multiplier: 1 };
  if (dart === 'DB') return { number: 'bull', multiplier: 2 };
  const prefix = dart[0];
  const num = parseInt(dart.slice(1), 10);
  if (isNaN(num)) return { number: null, multiplier: 0 };
  if (num >= 15 && num <= 20) {
    const mult = prefix === 'S' ? 1 : prefix === 'D' ? 2 : prefix === 'T' ? 3 : 0;
    return { number: num as MarkKey, multiplier: mult };
  }
  return { number: null, multiplier: 0 };
}

function generateCricketTurn(level: number, gameState: FullGameState, playerId: number): string[] {
  const params = LEVEL_PARAMS[level]!;
  const playerCS = gameState.cricket_state?.find((cs) => cs.player_id === playerId);
  if (!playerCS) return ['0', '0', '0'];
  const opponentCSList = (gameState.cricket_state ?? []).filter(
    (cs) => cs.player_id !== playerId
  ) as unknown as Record<string, number>[];
  const darts: string[] = [];

  const pendingMarks: PendingMarks = {
    15: playerCS.marks_15,
    16: playerCS.marks_16,
    17: playerCS.marks_17,
    18: playerCS.marks_18,
    19: playerCS.marks_19,
    20: playerCS.marks_20,
    bull: playerCS.marks_bull,
  };

  for (let i = 0; i < 3; i++) {
    const target = pickCricketTarget(level, pendingMarks, opponentCSList);
    const dart = throwDart(params, target);
    darts.push(dart);

    const { number, multiplier } = parseCricketDartInfo(dart);
    if (number && pendingMarks[number] !== undefined) {
      pendingMarks[number] += multiplier;
    }
  }

  return darts;
}

export function generateAiTurn(
  level: number | null,
  gameMode: GameMode,
  gameState: FullGameState,
  playerId: number
): { darts: string[] } {
  const clampedLevel = Math.max(1, Math.min(10, level || 1));

  if (gameMode === '501' || gameMode === '301') {
    const currentScore = gameState.scores[playerId] ?? parseInt(gameMode, 10);
    return { darts: generateX01Turn(clampedLevel, currentScore) };
  }

  if (gameMode === 'cricket') {
    return { darts: generateCricketTurn(clampedLevel, gameState, playerId) };
  }

  return { darts: ['0', '0', '0'] };
}
