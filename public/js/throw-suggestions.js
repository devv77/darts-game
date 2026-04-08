// Dynamic throw suggestion engine for x01 games
// Pure logic — no DOM manipulation

// Skill tiers based on 3-dart average
function getSkillTier(avg) {
  if (avg >= 75) return 'advanced';
  if (avg >= 55) return 'good';
  if (avg >= 35) return 'club';
  return 'beginner';
}

// Preferred checkout targets (comfortable doubles + setup scores)
const preferredCheckouts = [40, 32, 36, 24, 16, 20, 8];

// Safer checkout paths for bust-prone players (avoid treble-first combos)
const saferCheckouts = {
  170: 'S20 T18 D20',  // instead of T20 T20 DB
  167: 'S19 T18 D20',
  164: 'S18 T18 D19',
  161: 'S17 T20 D17',
  160: 'S20 T20 D20',
  158: 'S20 T20 D19',
  157: 'S19 T20 D20',
  156: 'S20 T20 D18',
  155: 'S19 T20 D19',
  154: 'S18 T20 D20',
  153: 'S19 T20 D18',
  152: 'S20 T20 D16',
  151: 'S17 T18 D20',
  150: 'S18 T20 D18',
  100: 'S20 S40 D20',
  97:  'S19 S20 D20',
  96:  'S20 S20 D18',
  95:  'S19 S20 D18',
  80:  'S20 S20 D20',
};

// Standard checkout table (from x01-view.js)
const checkoutHints = {
  170:'T20 T20 DB',167:'T20 T19 DB',164:'T20 T18 DB',161:'T20 T17 DB',
  160:'T20 T20 D20',158:'T20 T20 D19',157:'T20 T19 D20',156:'T20 T20 D18',
  155:'T20 T19 D19',154:'T20 T18 D20',153:'T20 T19 D18',152:'T20 T20 D16',
  151:'T20 T17 D20',150:'T20 T18 D18',
  100:'T20 D20',97:'T19 D20',96:'T20 D18',95:'T19 D19',
  80:'T20 D10',60:'S20 D20',50:'DB',40:'D20',
  38:'D19',36:'D18',34:'D17',32:'D16',30:'D15',28:'D14',26:'D13',
  24:'D12',22:'D11',20:'D10',18:'D9',16:'D8',14:'D7',12:'D6',
  10:'D5',8:'D4',6:'D3',4:'D2',2:'D1'
};

/**
 * Get a personalized throw suggestion
 * @param {number} score - Current remaining score
 * @param {object|null} stats - Player lifetime stats from API (null if unavailable)
 * @param {object} ctx - Game context: { round, lastTurnBusted, turnsThisLeg }
 * @returns {{ text: string, type: string }|null}
 */
function getSuggestion(score, stats, ctx) {
  // No stats available — fall back to standard checkout only
  if (!stats || stats.total_turns === 0) {
    return getCheckoutSuggestion(score, false);
  }

  const avg = stats.x01_average || 0;
  const tier = getSkillTier(avg);
  const bustRate = stats.bust_rate || 0;
  const highBustRate = bustRate > 20;

  // Checkout phase (score <= 170)
  if (score <= 170 && score >= 2) {
    return getCheckoutSuggestion(score, highBustRate);
  }

  // Setup phase (171-300) — suggest what to score to leave a good checkout
  if (score <= 300) {
    return getSetupSuggestion(score, tier, avg);
  }

  // Scoring phase (> 300)
  return getScoringSuggestion(score, tier, avg, stats, ctx);
}

function getCheckoutSuggestion(score, highBustRate) {
  if (score < 2 || score > 170) return null;

  // For high bust-rate players, suggest safer paths
  if (highBustRate && saferCheckouts[score]) {
    return { text: 'Safe: ' + saferCheckouts[score], type: 'safety' };
  }

  const hint = checkoutHints[score];
  if (hint) {
    return { text: 'Checkout: ' + hint, type: 'checkout' };
  }

  return { text: score + ' remaining', type: 'checkout' };
}

function getSetupSuggestion(score, tier, avg) {
  // Find the best checkout to leave
  let bestTarget = null;
  let bestCheckout = null;

  for (const checkout of preferredCheckouts) {
    const needed = score - checkout;
    if (needed > 0 && needed <= 180) {
      // Check if this is achievable in one turn at their level
      if (needed <= avg * 1.5) {
        bestTarget = needed;
        bestCheckout = checkout;
        break;
      }
    }
  }

  if (bestTarget && bestCheckout) {
    const doubleNum = bestCheckout / 2;
    return {
      text: 'Score ' + bestTarget + '+ to leave D' + doubleNum,
      type: 'setup'
    };
  }

  // Fallback: just show turn target like scoring phase
  const target = getTurnTarget(tier);
  const area = getAimArea(tier);
  return { text: area + '. Target: ' + target + '+', type: 'setup' };
}

function getScoringSuggestion(score, tier, avg, stats, ctx) {
  // First 3 rounds: show first-9 context
  if (ctx.round <= 3 && ctx.turnsThisLeg < 3 && stats.first_9_average > 0) {
    const f9 = stats.first_9_average;
    const target = getTurnTarget(tier);
    return {
      text: 'First-9 avg: ' + f9 + '. Target: ' + target + '+',
      type: 'scoring'
    };
  }

  // After a bust: encouraging nudge
  if (ctx.lastTurnBusted) {
    const target = getTurnTarget(tier);
    return { text: 'Steady. Aim for ' + target + '+', type: 'scoring' };
  }

  // Standard scoring suggestion
  const target = getTurnTarget(tier);
  const area = getAimArea(tier);
  return { text: area + '. Target: ' + target + '+', type: 'scoring' };
}

function getTurnTarget(tier) {
  switch (tier) {
    case 'advanced': return 80;
    case 'good': return 65;
    case 'club': return 50;
    default: return 30;
  }
}

function getAimArea(tier) {
  switch (tier) {
    case 'advanced': return 'Aim T20/T19';
    case 'good': return 'Aim T20';
    case 'club': return 'Aim T19 area';
    default: return 'Aim S20/S19';
  }
}
