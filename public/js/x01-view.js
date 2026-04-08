// x01 game view (501/301)
let gameState = null;
let socket = null;
let isDartByDart = false;
let gameOverShown = false;

// Force fresh load if page is restored from bfcache
window.addEventListener('pageshow', (event) => {
  if (event.persisted) window.location.reload();
});

document.addEventListener('DOMContentLoaded', () => {
  const gameId = getGameIdFromURL();
  if (!gameId) return;

  // Reset overlay on fresh page load
  document.getElementById('game-over-overlay').hidden = true;
  gameOverShown = false;

  socket = io();
  socket.emit('join-game', { gameId: parseInt(gameId) });

  socket.on('game-state', (state) => {
    gameState = state;

    // Hide game-over overlay if this is an in-progress game
    if (state.status === 'in_progress') {
      document.getElementById('game-over-overlay').hidden = true;
      gameOverShown = false;
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
  // Quick score presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      submitQuickScore(parseInt(btn.dataset.score));
    });
  });

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
    if (numpadValue === '') {
      display.textContent = 'Enter score';
      display.classList.add('empty');
    } else {
      display.textContent = numpadValue;
      display.classList.remove('empty');
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
  document.getElementById('game-mode-label').textContent = state.mode;
  document.getElementById('round-num').textContent = state.current_round;

  renderScoreboard(state);

  const currentPlayer = state.players[state.current_player_index];
  const isAiTurn = currentPlayer && currentPlayer.is_ai && state.status === 'in_progress';

  // Show/hide AI thinking vs human input
  document.getElementById('ai-thinking').hidden = !isAiTurn;
  document.getElementById('input-area').hidden = isAiTurn;

  // Show x01 input, hide cricket
  document.getElementById('x01-input').hidden = false;
  document.getElementById('cricket-input').hidden = true;

  document.getElementById('current-player-name').textContent =
    state.status === 'in_progress' ? `${currentPlayer.name}'s turn` : 'Game Over';

  // Checkout hint
  const hintEl = document.getElementById('checkout-hint');
  if (state.status === 'in_progress') {
    const score = state.scores[currentPlayer.id];
    if (score <= 170 && score >= 2) {
      // Fetch checkout from server or use local table
      hintEl.textContent = `Checkout: ${getCheckoutHint(score)}`;
      hintEl.hidden = false;
    } else {
      hintEl.hidden = true;
    }
  } else {
    hintEl.hidden = true;
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

  // Stats
  const statsEl = document.getElementById('game-over-stats');
  statsEl.innerHTML = gameState.players.map(p => {
    const turns = gameState.turns.filter(t => t.player_id === p.id);
    const validTurns = turns.filter(t => !t.is_bust);
    const total = validTurns.reduce((s, t) => s + t.score_total, 0);
    const avg = turns.length > 0 ? (total / turns.length).toFixed(1) : '0';
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
        player_ids: gameState.players.map(p => p.id)
      });
      window.location.href = `/game?id=${game.id}`;
    } catch (err) {
      newBtn.disabled = false;
    }
  });
}

// Simple local checkout hints (subset)
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

function getCheckoutHint(score) {
  return checkoutHints[score] || `${score} remaining`;
}
