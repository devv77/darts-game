const { getCheckout } = require('./checkout-table');

// Real dartboard clockwise order
const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

const LEVEL_PARAMS = {
  1:  { name: 'Beginner',     targetAcc: 0.20, trebleRate: 0.03, doubleRate: 0.05, missRate: 0.25, scatter: 3 },
  2:  { name: 'Novice',       targetAcc: 0.28, trebleRate: 0.05, doubleRate: 0.10, missRate: 0.20, scatter: 3 },
  3:  { name: 'Casual',       targetAcc: 0.36, trebleRate: 0.10, doubleRate: 0.15, missRate: 0.15, scatter: 2 },
  4:  { name: 'Pub Player',   targetAcc: 0.44, trebleRate: 0.15, doubleRate: 0.20, missRate: 0.12, scatter: 2 },
  5:  { name: 'Club Player',  targetAcc: 0.52, trebleRate: 0.22, doubleRate: 0.28, missRate: 0.09, scatter: 2 },
  6:  { name: 'League',       targetAcc: 0.60, trebleRate: 0.30, doubleRate: 0.35, missRate: 0.07, scatter: 1 },
  7:  { name: 'County',       targetAcc: 0.68, trebleRate: 0.38, doubleRate: 0.42, missRate: 0.05, scatter: 1 },
  8:  { name: 'Semi-Pro',     targetAcc: 0.76, trebleRate: 0.46, doubleRate: 0.52, missRate: 0.03, scatter: 1 },
  9:  { name: 'Pro',          targetAcc: 0.85, trebleRate: 0.55, doubleRate: 0.62, missRate: 0.02, scatter: 1 },
  10: { name: 'World Class',  targetAcc: 0.93, trebleRate: 0.65, doubleRate: 0.75, missRate: 0.01, scatter: 1 },
};

// Get adjacent segment on the board ring
function getAdjacentSegment(segment, offset) {
  const idx = BOARD_ORDER.indexOf(segment);
  if (idx === -1) return segment;
  const newIdx = ((idx + offset) % 20 + 20) % 20;
  return BOARD_ORDER[newIdx];
}

// Scatter to a random adjacent segment
function scatterSegment(segment, scatterRange) {
  const offset = Math.floor(Math.random() * (scatterRange * 2 + 1)) - scatterRange;
  return getAdjacentSegment(segment, offset);
}

function roll(probability) {
  return Math.random() < probability;
}

/**
 * Simulate throwing a single dart at a target.
 * target: { segment: 1-20, ring: 'S'|'D'|'T' } or { segment: 'bull', ring: 'SB'|'DB' }
 * Returns a dart string like 'T20', 'D16', 'S5', 'SB', 'DB', or '0'
 */
function throwDart(params, target) {
  // Complete miss (off the board)
  if (roll(params.missRate)) return '0';

  // Bull target
  if (target.segment === 'bull') {
    if (target.ring === 'DB') {
      if (roll(params.doubleRate)) return 'DB';
      if (roll(params.targetAcc * 0.5)) return 'SB';
      // Scatter to a random single
      const seg = BOARD_ORDER[Math.floor(Math.random() * 20)];
      return 'S' + seg;
    }
    // Aiming SB
    if (roll(params.targetAcc)) return 'SB';
    if (roll(0.08)) return 'DB'; // lucky bull
    const seg = BOARD_ORDER[Math.floor(Math.random() * 20)];
    return 'S' + seg;
  }

  const seg = target.segment;

  // Treble target
  if (target.ring === 'T') {
    if (roll(params.trebleRate)) return 'T' + seg;
    // Hit the right segment but wrong ring (single)
    if (roll(params.targetAcc)) return 'S' + seg;
    // Scatter to adjacent segment single
    const scattered = scatterSegment(seg, params.scatter);
    // Small chance of accidentally hitting treble or double of scattered segment
    if (roll(0.05)) return 'T' + scattered;
    if (roll(0.05)) return 'D' + scattered;
    return 'S' + scattered;
  }

  // Double target (edge of board)
  if (target.ring === 'D') {
    if (roll(params.doubleRate)) return 'D' + seg;
    // Missed the double ring — could land as single inside the double
    if (roll(params.targetAcc * 0.6)) return 'S' + seg;
    // Off the board (doubles are on the edge) — 30% chance
    if (roll(0.30)) return '0';
    // Scatter to adjacent segment single
    const scattered = scatterSegment(seg, params.scatter);
    return 'S' + scattered;
  }

  // Single target
  if (roll(params.targetAcc)) return 'S' + seg;
  // Scatter
  const scattered = scatterSegment(seg, params.scatter);
  // Small accidental treble/double of scattered
  if (roll(0.05)) return 'T' + scattered;
  if (roll(0.04)) return 'D' + scattered;
  return 'S' + scattered;
}

function parseDartScore(dart) {
  if (!dart || dart === '0') return 0;
  if (dart === 'SB') return 25;
  if (dart === 'DB') return 50;
  const prefix = dart[0];
  const num = parseInt(dart.slice(1));
  if (isNaN(num)) return 0;
  if (prefix === 'S') return num;
  if (prefix === 'D') return num * 2;
  if (prefix === 'T') return num * 3;
  return 0;
}

/**
 * Parse a checkout string like "T20 S10 D20" into dart targets
 */
function parseCheckoutTargets(checkoutStr) {
  if (!checkoutStr) return null;
  return checkoutStr.split(' ').map(d => {
    if (d === 'DB') return { segment: 'bull', ring: 'DB' };
    if (d === 'SB') return { segment: 'bull', ring: 'SB' };
    const ring = d[0]; // S, D, T
    const seg = parseInt(d.slice(1));
    return { segment: seg, ring };
  });
}

// ============= X01 STRATEGY =============

function pickX01Target(level, remainingScore, dartsLeft) {
  const params = LEVEL_PARAMS[level];

  // Can we checkout?
  const checkoutStr = getCheckout(remainingScore);
  if (checkoutStr) {
    const targets = parseCheckoutTargets(checkoutStr);
    if (targets && targets.length <= dartsLeft) {
      // Higher levels follow checkout table at higher scores
      const checkoutThreshold = level <= 3 ? 40 : level <= 6 ? 120 : 170;
      if (remainingScore <= checkoutThreshold) {
        return targets[0]; // Return first dart of checkout path
      }
    }
  }

  // Simple checkout attempts for low levels with low scores
  if (remainingScore <= 40 && remainingScore % 2 === 0) {
    return { segment: remainingScore / 2, ring: 'D' };
  }
  if (remainingScore <= 40 && remainingScore % 2 === 1) {
    // Aim S1 to make it even
    return { segment: 1, ring: 'S' };
  }

  // Scoring phase
  if (level <= 3) {
    // Low levels aim for single 20 (safer)
    return { segment: 20, ring: 'S' };
  }
  // Higher levels aim for treble 20
  return { segment: 20, ring: 'T' };
}

function generateX01Turn(level, currentScore) {
  const params = LEVEL_PARAMS[level];
  const darts = [];
  let remaining = currentScore;

  for (let i = 0; i < 3; i++) {
    const dartsLeft = 3 - i;
    let target = pickX01Target(level, remaining, dartsLeft);

    // If we're following a multi-dart checkout, pick the right dart in sequence
    const checkoutStr = getCheckout(remaining);
    if (checkoutStr) {
      const targets = parseCheckoutTargets(checkoutStr);
      const checkoutThreshold = level <= 3 ? 40 : level <= 6 ? 120 : 170;
      if (targets && targets.length <= dartsLeft && remaining <= checkoutThreshold) {
        target = targets[0]; // Always the first target for current remaining
      }
    }

    const dart = throwDart(params, target);
    const dartScore = parseDartScore(dart);
    const newRemaining = remaining - dartScore;

    darts.push(dart);

    // Check bust: below 0, equals 1, or equals 0 without double finish
    if (newRemaining < 0 || newRemaining === 1) {
      break; // Bust — remaining darts don't matter
    }
    if (newRemaining === 0) {
      if (!dart.startsWith('D') && dart !== 'DB') {
        break; // Bust — didn't finish on double
      }
      break; // Won!
    }

    remaining = newRemaining;
  }

  return darts;
}

// ============= CRICKET STRATEGY =============

const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15];

function generateCricketTurn(level, gameState, playerId) {
  const params = LEVEL_PARAMS[level];
  const playerCS = gameState.cricket_state.find(cs => cs.player_id === playerId);
  const opponentCSList = gameState.cricket_state.filter(cs => cs.player_id !== playerId);
  const darts = [];

  // Track pending marks within this turn
  const pendingMarks = {
    15: playerCS.marks_15, 16: playerCS.marks_16, 17: playerCS.marks_17,
    18: playerCS.marks_18, 19: playerCS.marks_19, 20: playerCS.marks_20,
    bull: playerCS.marks_bull
  };

  for (let i = 0; i < 3; i++) {
    const target = pickCricketTarget(level, pendingMarks, opponentCSList, params);
    const dart = throwDart(params, target);
    darts.push(dart);

    // Update pending marks for next dart decision
    const { number, multiplier } = parseCricketDartInfo(dart);
    if (number && pendingMarks[number] !== undefined) {
      pendingMarks[number] += multiplier;
    }
  }

  return darts;
}

function pickCricketTarget(level, pendingMarks, opponentCSList, params) {
  const allNumbers = [...CRICKET_NUMBERS, 'bull'];
  const unclosed = allNumbers.filter(n => pendingMarks[n] < 3);
  const closed = allNumbers.filter(n => pendingMarks[n] >= 3);

  // Levels 1-3: Random unclosed number, mostly singles
  if (level <= 3) {
    if (unclosed.length === 0) {
      // All closed — aim to score on any number opponents haven't closed
      const scorable = findScorableNumbers(closed, opponentCSList);
      if (scorable.length > 0) {
        const num = scorable[Math.floor(Math.random() * scorable.length)];
        return makeTarget(num, level <= 1 ? 'S' : (roll(0.3) ? 'T' : 'S'));
      }
      return { segment: 20, ring: 'S' }; // Fallback
    }
    const num = unclosed[Math.floor(Math.random() * unclosed.length)];
    const ring = level <= 1 ? 'S' : (roll(0.25) ? 'T' : 'S');
    return makeTarget(num, ring);
  }

  // Levels 4-6: Target highest unclosed, aim trebles
  if (level <= 6) {
    if (unclosed.length === 0) {
      const scorable = findScorableNumbers(closed, opponentCSList);
      if (scorable.length > 0) {
        return makeTarget(scorable[0], 'T');
      }
      return { segment: 20, ring: 'T' };
    }
    // Prioritize by value (20 > 19 > ... > bull=25)
    const sorted = unclosed.sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0], 'T');
  }

  // Levels 7-10: Advanced strategy
  // Offensive: score on closed numbers opponents haven't closed
  const scorable = findScorableNumbers(closed, opponentCSList);

  // Defensive: close numbers opponents are close to closing
  const threatened = unclosed.filter(n => {
    const col = n === 'bull' ? 'marks_bull' : `marks_${n}`;
    return opponentCSList.some(os => os[col] >= 2);
  });

  // Efficiency: numbers we're close to closing (1-2 marks away)
  const almostClosed = unclosed.filter(n => pendingMarks[n] >= 1).sort((a, b) => pendingMarks[b] - pendingMarks[a]);

  // Decision priority for high levels
  if (threatened.length > 0 && roll(0.6)) {
    // Defend — close threatened numbers first
    const sorted = threatened.sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0], 'T');
  }

  if (almostClosed.length > 0 && roll(0.5)) {
    // Efficiency — finish what we started
    return makeTarget(almostClosed[0], 'T');
  }

  if (scorable.length > 0 && unclosed.length <= 2 && roll(0.4)) {
    // Offensive — pile on points when we're close to winning
    const best = scorable.sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(best[0], 'T');
  }

  // Default: highest unclosed
  if (unclosed.length > 0) {
    const sorted = unclosed.sort((a, b) => {
      const valA = a === 'bull' ? 25 : a;
      const valB = b === 'bull' ? 25 : b;
      return valB - valA;
    });
    return makeTarget(sorted[0], 'T');
  }

  // Everything closed — score
  if (scorable.length > 0) {
    return makeTarget(scorable[0], 'T');
  }

  return { segment: 20, ring: 'T' }; // Fallback
}

function findScorableNumbers(closedNumbers, opponentCSList) {
  return closedNumbers.filter(n => {
    const col = n === 'bull' ? 'marks_bull' : `marks_${n}`;
    return !opponentCSList.every(os => os[col] >= 3);
  }).sort((a, b) => {
    const valA = a === 'bull' ? 25 : a;
    const valB = b === 'bull' ? 25 : b;
    return valB - valA;
  });
}

function makeTarget(number, ring) {
  if (number === 'bull') {
    return { segment: 'bull', ring: ring === 'T' ? 'DB' : ring === 'D' ? 'DB' : 'SB' };
  }
  return { segment: number, ring };
}

function parseCricketDartInfo(dart) {
  if (!dart || dart === '0') return { number: null, multiplier: 0 };
  if (dart === 'SB') return { number: 'bull', multiplier: 1 };
  if (dart === 'DB') return { number: 'bull', multiplier: 2 };
  const prefix = dart[0];
  const num = parseInt(dart.slice(1));
  if (isNaN(num)) return { number: null, multiplier: 0 };
  // Only cricket numbers count
  if (num >= 15 && num <= 20) {
    const mult = prefix === 'S' ? 1 : prefix === 'D' ? 2 : prefix === 'T' ? 3 : 0;
    return { number: num, multiplier: mult };
  }
  return { number: null, multiplier: 0 };
}

// ============= MAIN EXPORT =============

function generateAiTurn(level, gameMode, gameState, playerId) {
  const clampedLevel = Math.max(1, Math.min(10, level || 1));

  if (gameMode === '501' || gameMode === '301') {
    const currentScore = gameState.scores[playerId];
    const darts = generateX01Turn(clampedLevel, currentScore);
    return { darts };
  }

  if (gameMode === 'cricket') {
    const darts = generateCricketTurn(clampedLevel, gameState, playerId);
    return { darts };
  }

  return { darts: ['0', '0', '0'] };
}

module.exports = { generateAiTurn, LEVEL_PARAMS };
