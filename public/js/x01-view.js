// x01 game view (501/301)
let gameState = null;
let socket = null;
let isDartByDart = false;
let gameOverShown = false;
let playerStatsCache = {};
let statsFetched = false;

// Force fresh load if page is restored from bfcache
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

// Keep screen awake during game
let wakeLock = null;
async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* user denied or not supported */ }
}
requestWakeLock();
// Re-acquire after visibility change (tab switch, screen unlock)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') requestWakeLock();
});

document.addEventListener('DOMContentLoaded', () => {
  const gameId = getGameIdFromURL();
  if (!gameId) return;

  // Reset overlay on fresh page load
  document.getElementById('game-over-overlay').hidden = true;
  gameOverShown = false;

  const parsedGameId = parseInt(gameId);
  socket = io();
  socket.emit('join-game', { gameId: parsedGameId });

  // Re-join game room on reconnect (phone sleep, Wi-Fi drop, etc.)
  socket.on('connect', () => {
    socket.emit('join-game', { gameId: parsedGameId });
  });

  socket.on('game-state', (state) => {
    gameState = state;

    // Hide game-over overlay if this is an in-progress game
    if (state.status === 'in_progress') {
      document.getElementById('game-over-overlay').hidden = true;
      gameOverShown = false;
    }

    // Fetch player stats once for throw suggestions
    if (!statsFetched && (state.mode === '501' || state.mode === '301')) {
      statsFetched = true;
      state.players.filter(p => !p.is_ai).forEach(p => {
        API.get('/api/stats/players/' + p.id)
          .then(stats => { playerStatsCache[p.id] = stats; })
          .catch(() => {});
      });
    }

    if (state.mode === '501' || state.mode === '301') {
      renderX01Game(state);
    } else if (state.mode === 'cricket') {
      renderCricketGame(state);
    }
  });

  socket.on('game-over', ({ winnerId }) => {
    showGameOver(winnerId);
  });

  socket.on('ai-thinking', ({ playerId }) => {
    document.getElementById('ai-thinking').hidden = false;
    document.getElementById('input-area').hidden = true;
  });

  setupX01Input();
  setupUndo();
});

let numpadValue = '';

function setupX01Input() {
  // Presets are now generated dynamically in updatePresets()

  // Custom on-screen numpad
  document.querySelectorAll('.numpad-key').forEach(btn => {
    btn.addEventListener('click', () => {
      const key = btn.dataset.key;
      if (key === 'clear') {
        numpadValue = '';
      } else if (key === 'submit') {
        const val = parseInt(numpadValue);
        if (numpadValue === '' || isNaN(val) || val < 0 || val > 180) return;
        submitQuickScore(val);
        numpadValue = '';
      } else {
        // Digit key — max 3 digits, max value 180
        const next = numpadValue + key;
        if (next.length <= 3 && parseInt(next) <= 180) {
          numpadValue = next;
        }
      }
      updateNumpadDisplay();
    });
  });

  function updateNumpadDisplay() {
    const display = document.getElementById('numpad-display');
    const numpad = document.querySelector('.custom-numpad');
    if (numpadValue === '') {
      display.textContent = 'Enter score';
      display.classList.add('empty');
      numpad.classList.remove('bogey-warning');
    } else {
      display.textContent = numpadValue;
      display.classList.remove('empty');
      // Bogey check
      if (gameState && gameState.status === 'in_progress') {
        const currentPlayer = gameState.players[gameState.current_player_index];
        const score = gameState.scores[currentPlayer.id];
        const remaining = score - parseInt(numpadValue);
        const bogey = checkBogey(remaining);
        if (bogey) {
          display.textContent = numpadValue + '  ⚠ leaves ' + bogey;
          numpad.classList.add('bogey-warning');
        } else {
          numpad.classList.remove('bogey-warning');
        }
      }
    }
  }

  // Toggle input mode
  document.getElementById('toggle-input-mode')?.addEventListener('click', () => {
    isDartByDart = !isDartByDart;
    document.getElementById('quick-input-area').hidden = isDartByDart;
    document.getElementById('dart-by-dart-area').hidden = !isDartByDart;
    document.getElementById('toggle-input-mode').textContent =
      isDartByDart ? 'Switch to Quick Input' : 'Switch to Dart-by-Dart';
    resetDartInput();
    renderDartsDisplay('darts-thrown');
  });

  // Dart by dart
  initDartByDart('dart-by-dart-area', 'darts-thrown', 'confirm-darts-btn', (darts) => {
    if (!gameState || gameState.status !== 'in_progress') return;
    const currentPlayer = gameState.players[gameState.current_player_index];
    socket.emit('submit-turn', {
      gameId: gameState.id,
      playerId: currentPlayer.id,
      darts: darts
    });
  });
}

function updatePresets(score, stats) {
  const container = document.querySelector('.preset-scores');
  if (!container) return;

  const presets = getPresets(score, stats);
  container.innerHTML = presets.map(p => {
    let cls = 'preset-btn';
    if (p.style === 'max') cls += ' max-score';
    else if (p.style === 'ton-plus') cls += ' ton-plus';
    else if (p.style === 'ton') cls += ' ton';
    else if (p.style === 'checkout') cls += ' checkout-preset';
    else if (p.style === 'miss') cls += ' miss-preset';
    return `<button class="${cls}" data-score="${p.value}">${p.label}</button>`;
  }).join('');

  // Re-bind click handlers
  container.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      submitQuickScore(parseInt(btn.dataset.score));
    });
  });
}

function submitQuickScore(score) {
  if (!gameState || gameState.status !== 'in_progress') return;
  const currentPlayer = gameState.players[gameState.current_player_index];
  socket.emit('submit-turn', {
    gameId: gameState.id,
    playerId: currentPlayer.id,
    darts: [],
    scoreTotal: score
  });
}

function renderX01Game(state) {
  const settings = state.parsed_settings || {};
  const format = settings.format || 'single';
  let modeLabel = state.mode;
  if (format === 'legs') {
    modeLabel += ` Bo${settings.bestOfLegs}`;
  } else if (format === 'sets') {
    modeLabel += ` Bo${settings.bestOfSets}S`;
  }
  document.getElementById('game-mode-label').textContent = modeLabel;
  document.getElementById('round-num').textContent = state.current_round;

  renderScoreboard(state);

  const currentPlayer = state.players[state.current_player_index];

  // Tint UI to active player's color
  if (state.status === 'in_progress' && currentPlayer) {
    document.documentElement.style.setProperty('--player-color', currentPlayer.avatar_color);
  }

  // Update dynamic presets
  if (state.status === 'in_progress' && !currentPlayer.is_ai) {
    const score = state.scores[currentPlayer.id];
    const stats = playerStatsCache[currentPlayer.id] || null;
    updatePresets(score, stats);
  }
  const isAiTurn = currentPlayer && currentPlayer.is_ai && state.status === 'in_progress';

  // Show/hide AI thinking vs human input
  document.getElementById('ai-thinking').hidden = !isAiTurn;
  document.getElementById('input-area').hidden = isAiTurn;

  // Show x01 input, hide cricket
  document.getElementById('x01-input').hidden = false;
  document.getElementById('cricket-input').hidden = true;

  document.getElementById('current-player-name').textContent =
    state.status === 'in_progress' ? `${currentPlayer.name}'s turn` : 'Game Over';

  // Dynamic throw suggestion
  const stripEl = document.getElementById('suggestion-strip');
  if (state.status === 'in_progress' && !currentPlayer.is_ai) {
    const score = state.scores[currentPlayer.id];
    const stats = playerStatsCache[currentPlayer.id] || null;
    const playerTurns = state.turns.filter(t => t.player_id === currentPlayer.id);
    const lastTurn = playerTurns.length > 0 ? playerTurns[playerTurns.length - 1] : null;
    const turnsThisLeg = state.turns.filter(
      t => t.player_id === currentPlayer.id &&
           t.set_num === state.current_set && t.leg_num === state.current_leg
    ).length;

    const suggestion = getSuggestion(score, stats, {
      round: state.current_round,
      lastTurnBusted: lastTurn ? !!lastTurn.is_bust : false,
      turnsThisLeg: turnsThisLeg
    });

    if (suggestion) {
      document.getElementById('suggestion-text').textContent = suggestion.text;
      stripEl.className = 'suggestion-strip suggestion-' + suggestion.type;
      stripEl.hidden = false;
    } else {
      stripEl.hidden = true;
    }
  } else {
    stripEl.hidden = true;
  }

  // Throw history
  renderThrowHistory(state);

  // Game over check
  if (state.status === 'completed' && state.winner_id) {
    showGameOver(state.winner_id);
  }
}

function renderThrowHistory(state) {
  const container = document.getElementById('throw-history');
  if (!state || !state.players || state.turns.length === 0) {
    container.hidden = true;
    return;
  }
  container.hidden = false;

  const html = state.players.map(p => {
    const playerTurns = state.turns.filter(t => t.player_id === p.id);
    const last3 = playerTurns.slice(-3);

    const rows = last3.map(t => {
      const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean);
      const dartsStr = darts.length > 0
        ? darts.map(d => `<span class="hist-dart">${formatDart(d)}</span>`).join(' ')
        : '';
      const scoreClass = t.is_bust ? 'hist-bust' : (t.score_total >= 100 ? 'hist-ton' : '');
      const label = t.is_bust ? 'BUST' : t.score_total;
      return `<div class="hist-row">
        <span class="hist-darts">${dartsStr}</span>
        <span class="hist-score ${scoreClass}">${label}</span>
      </div>`;
    }).join('');

    const isActive = state.players[state.current_player_index]?.id === p.id && state.status === 'in_progress';
    return `<div class="hist-player ${isActive ? 'hist-active' : ''}">
      <div class="hist-name" style="border-color:${p.avatar_color}">${p.name}</div>
      ${rows || '<div class="hist-row hist-empty">No throws yet</div>'}
    </div>`;
  }).join('');

  container.innerHTML = html;
}

function setupUndo() {
  document.getElementById('undo-btn')?.addEventListener('click', () => {
    if (!gameState) return;
    socket.emit('undo-turn', { gameId: gameState.id });
  });
}

function showGameOver(winnerId) {
  if (gameOverShown) return;
  gameOverShown = true;

  const overlay = document.getElementById('game-over-overlay');
  const winner = gameState.players.find(p => p.id === winnerId);
  document.getElementById('winner-text').textContent = `${winner ? winner.name : 'Unknown'} Wins!`;

  // Stats — true 3-dart average based on actual darts thrown
  const statsEl = document.getElementById('game-over-stats');
  statsEl.innerHTML = gameState.players.map(p => {
    const turns = gameState.turns.filter(t => t.player_id === p.id);
    const total = turns.reduce((s, t) => s + t.score_total, 0);
    let darts = 0;
    for (const t of turns) {
      const d = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
      darts += d > 0 ? d : 3;
    }
    const avg = darts > 0 ? ((total / darts) * 3).toFixed(1) : '0';
    return `<p><strong>${p.name}</strong>: ${turns.length} turns, avg ${avg}</p>`;
  }).join('');

  overlay.hidden = false;

  // Rematch — replace button to avoid stacking duplicate listeners
  const oldBtn = document.getElementById('rematch-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', async () => {
    newBtn.disabled = true;
    try {
      const game = await API.post('/api/games', {
        mode: gameState.mode,
        player_ids: gameState.players.map(p => p.id),
        settings: gameState.parsed_settings || {}
      });
      window.location.href = `/game?id=${game.id}`;
    } catch (err) {
      newBtn.disabled = false;
    }
  });
}

