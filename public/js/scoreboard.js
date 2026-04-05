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
  container.innerHTML = state.players.map((p, i) => {
    const score = state.scores[p.id];
    const isActive = i === state.current_player_index && state.status === 'in_progress';
    const playerTurns = state.turns.filter(t => t.player_id === p.id && !t.is_bust);
    const totalScored = playerTurns.reduce((sum, t) => sum + t.score_total, 0);
    const avg = playerTurns.length > 0 ? (totalScored / playerTurns.length).toFixed(1) : '-';

    return `
      <div class="score-card ${isActive ? 'active' : ''}" style="border-top: 3px solid ${p.avatar_color}">
        <div class="player-name">${p.name}${p.is_ai ? ' <span class="ai-tag">AI</span>' : ''}</div>
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
