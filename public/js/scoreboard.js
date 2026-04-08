// Renders the scoreboard for all game modes
function renderScoreboard(state) {
  const container = document.getElementById('scoreboard');
  if (!state || !state.players) return;

  if (state.mode === '501' || state.mode === '301') {
    renderX01Scoreboard(container, state);
  } else if (state.mode === 'cricket') {
    renderCricketScoreboard(container, state);
  }
}

function renderX01Scoreboard(container, state) {
  const settings = state.parsed_settings || {};
  const format = settings.format || 'single';
  const showLegs = format === 'legs' || format === 'sets';
  const showSets = format === 'sets';

  container.innerHTML = state.players.map((p, i) => {
    const score = state.scores[p.id];
    const isActive = i === state.current_player_index && state.status === 'in_progress';
    const isStarting = i === state.leg_starting_player_index && state.status === 'in_progress';
    // True 3-dart average: (total_points / actual_darts_thrown) * 3
    const allPlayerTurns = state.turns.filter(t => t.player_id === p.id);
    const totalScored = allPlayerTurns.reduce((sum, t) => sum + t.score_total, 0);
    let dartsThrown = 0;
    for (const t of allPlayerTurns) {
      const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
      dartsThrown += darts > 0 ? darts : 3;
    }
    const avg = dartsThrown > 0 ? ((totalScored / dartsThrown) * 3).toFixed(1) : '-';

    // Build match score badges
    let matchBadges = '';
    if (showSets) {
      matchBadges = `<div class="match-badges">
        <span class="match-badge sets-badge">S:${p.sets_won}</span>
        <span class="match-badge legs-badge">L:${p.legs_won}</span>
      </div>`;
    } else if (showLegs) {
      matchBadges = `<div class="match-badges">
        <span class="match-badge legs-badge">L:${p.legs_won}</span>
      </div>`;
    }

    const dartIcon = isStarting ? '<span class="starting-indicator" title="Has the darts">&#127919;</span>' : '';

    return `
      <div class="score-card ${isActive ? 'active' : ''}" style="border-top: 3px solid ${p.avatar_color}">
        <div class="player-name">${dartIcon}${p.name}${p.is_ai ? ' <span class="ai-tag">AI</span>' : ''}</div>
        ${matchBadges}
        <div class="player-score">${score}</div>
        <div class="player-avg">Avg: ${avg}</div>
      </div>
    `;
  }).join('');
}

function renderCricketScoreboard(container, state) {
  // Cricket uses the cricket grid instead
  container.innerHTML = state.players.map((p, i) => {
    const cs = state.cricket_state.find(c => c.player_id === p.id);
    const isActive = i === state.current_player_index && state.status === 'in_progress';
    return `
      <div class="score-card ${isActive ? 'active' : ''}" style="border-top: 3px solid ${p.avatar_color}">
        <div class="player-name">${p.name}${p.is_ai ? ' <span class="ai-tag">AI</span>' : ''}</div>
        <div class="player-score">${cs ? cs.points : 0}</div>
      </div>
    `;
  }).join('');
}
