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

// Complete checkout table for all scores 2-170
const checkoutHints = {
  170:'T20 T20 DB',167:'T20 T19 DB',164:'T20 T18 DB',161:'T20 T17 DB',
  160:'T20 T20 D20',158:'T20 T20 D19',157:'T20 T19 D20',156:'T20 T20 D18',
  155:'T20 T19 D19',154:'T20 T18 D20',153:'T20 T19 D18',152:'T20 T20 D16',
  151:'T20 T17 D20',150:'T20 T18 D18',149:'T20 T19 D16',148:'T20 T16 D20',
  147:'T20 T17 D18',146:'T20 T18 D16',145:'T20 T15 D20',144:'T20 T20 D12',
  143:'T20 T17 D16',142:'T20 T14 D20',141:'T20 T19 D12',140:'T20 T20 D10',
  139:'T20 T13 D20',138:'T20 T18 D12',137:'T20 T19 D10',136:'T20 T20 D8',
  135:'T20 T17 D12',134:'T20 T14 D16',133:'T20 T19 D8',132:'T20 T16 D12',
  131:'T20 T13 D16',130:'T20 T18 D8',129:'T19 T16 D12',128:'T18 T14 D16',
  127:'T20 T17 D8',126:'T19 T19 D6',125:'T20 T15 D10',124:'T20 T16 D8',
  123:'T19 T16 D9',122:'T18 T18 D7',121:'T20 T11 D14',120:'T20 S20 D20',
  119:'T19 T12 D13',118:'T20 S18 D20',117:'T20 S17 D20',116:'T20 S16 D20',
  115:'T20 S15 D20',114:'T20 S14 D20',113:'T20 S13 D20',112:'T20 S12 D20',
  111:'T20 S11 D20',110:'T20 S10 D20',109:'T20 S9 D20',108:'T20 S8 D20',
  107:'T19 S10 D20',106:'T20 S6 D20',105:'T20 S5 D20',104:'T18 S10 D20',
  103:'T20 S3 D20',102:'T20 S2 D20',101:'T20 S1 D20',
  100:'T20 D20',99:'T19 S2 D20',98:'T20 D19',97:'T19 D20',96:'T20 D18',
  95:'T19 D19',94:'T18 D20',93:'T19 D18',92:'T20 D16',91:'T17 D20',
  90:'T18 D18',89:'T19 D16',88:'T16 D20',87:'T17 D18',86:'T18 D16',
  85:'T15 D20',84:'T20 D12',83:'T17 D16',82:'T14 D20',81:'T19 D12',
  80:'T20 D10',79:'T13 D20',78:'T18 D12',77:'T19 D10',76:'T20 D8',
  75:'T17 D12',74:'T14 D16',73:'T19 D8',72:'T16 D12',71:'T13 D16',
  70:'T18 D8',69:'T19 D6',68:'T20 D4',67:'T17 D8',66:'T10 D18',
  65:'T19 D4',64:'T16 D8',63:'T13 D12',62:'T10 D16',61:'T15 D8',
  60:'S20 D20',59:'S19 D20',58:'S18 D20',57:'S17 D20',56:'S16 D20',
  55:'S15 D20',54:'S14 D20',53:'S13 D20',52:'S12 D20',51:'S11 D20',
  50:'DB',49:'S9 D20',48:'S8 D20',47:'S7 D20',46:'S6 D20',
  45:'S5 D20',44:'S4 D20',43:'S3 D20',42:'S2 D20',41:'S1 D20',
  40:'D20',39:'S7 D16',38:'D19',37:'S5 D16',36:'D18',35:'S3 D16',
  34:'D17',33:'S1 D16',32:'D16',31:'S7 D12',30:'D15',29:'S5 D12',
  28:'D14',27:'S3 D12',26:'D13',25:'S1 D12',24:'D12',23:'S7 D8',
  22:'D11',21:'S5 D8',20:'D10',19:'S3 D8',18:'D9',17:'S1 D8',
  16:'D8',15:'S7 D4',14:'D7',13:'S5 D4',12:'D6',11:'S3 D4',
  10:'D5',9:'S1 D4',8:'D4',7:'S3 D2',6:'D3',5:'S1 D2',4:'D2',
  3:'S1 D1',2:'D1'
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

/**
 * Get dynamic preset scores based on player stats and current score
 * @param {number} score - Current remaining score
 * @param {object|null} stats - Player lifetime stats
 * @returns {Array<{value: number, label: string, style: string}>}
 */
function getPresets(score, stats) {
  const avg = (stats && stats.x01_average) || 0;
  const tier = getSkillTier(avg);

  // Base presets per skill tier (most commonly hit scores)
  let base;
  switch (tier) {
    case 'advanced':
      base = [60, 85, 100, 120, 140, 160, 180];
      break;
    case 'good':
      base = [41, 60, 80, 85, 100, 140, 180];
      break;
    case 'club':
      base = [26, 41, 45, 60, 80, 100, 140];
      break;
    default: // beginner
      base = [10, 20, 26, 30, 41, 45, 60];
      break;
  }

  // Filter out presets higher than the current score
  base = base.filter(v => v <= score);

  // If score is achievable in one turn (≤ 180), add it as a checkout preset
  const hasCheckout = score >= 2 && score <= 180 && !base.includes(score);

  // Build final list: fill to 8 slots
  let presets = [];

  // Always include 0 (miss/bust) as first
  presets.push({ value: 0, label: '0', style: 'miss' });

  // Add base presets
  for (const v of base) {
    if (presets.length >= (hasCheckout ? 7 : 8)) break;
    let style = '';
    if (v === 180) style = 'max';
    else if (v >= 140) style = 'ton-plus';
    else if (v >= 100) style = 'ton';
    presets.push({ value: v, label: String(v), style });
  }

  // Add checkout preset if applicable
  if (hasCheckout) {
    presets.push({ value: score, label: String(score), style: 'checkout' });
  }

  return presets;
}
