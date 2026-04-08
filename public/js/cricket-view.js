// Cricket game view
const CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15, 'Bull'];
let cricketDarts = [];
let cricketMultiplier = 1;

function renderCricketGame(state) {
  document.getElementById('game-mode-label').textContent = 'Cricket';
  document.getElementById('round-num').textContent = state.current_round;

  renderScoreboard(state);

  const currentPlayer = state.players[state.current_player_index];
  const isAiTurn = currentPlayer && currentPlayer.is_ai && state.status === 'in_progress';

  // Tint UI to active player's color
  if (state.status === 'in_progress' && currentPlayer) {
    document.documentElement.style.setProperty('--player-color', currentPlayer.avatar_color);
  }

  // Show/hide AI thinking vs human input
  document.getElementById('ai-thinking').hidden = !isAiTurn;
  document.getElementById('input-area').hidden = isAiTurn;

  // Show cricket input, hide x01
  document.getElementById('x01-input').hidden = true;
  document.getElementById('cricket-input').hidden = false;

  // Cricket grid
  renderCricketGrid(state);

  document.getElementById('cricket-player-name').textContent =
    state.status === 'in_progress' ? `${currentPlayer.name}'s turn` : 'Game Over';

  if (state.status === 'completed' && state.winner_id) {
    showGameOver(state.winner_id);
  }
}

function renderCricketGrid(state) {
  const gridEl = document.getElementById('cricket-grid');
  gridEl.hidden = false;

  const markSymbols = (count) => {
    if (count === 0) return '';
    if (count === 1) return '/';
    if (count === 2) return 'X';
    return 'O'; // closed (3+)
  };

  let html = '<table class="cricket-table"><thead><tr><th></th>';
  state.players.forEach(p => {
    html += `<th style="color:${p.avatar_color}">${p.name}</th>`;
  });
  html += '</tr></thead><tbody>';

  const numbers = [20, 19, 18, 17, 16, 15];
  for (const num of numbers) {
    html += `<tr><td class="number-col">${num}</td>`;
    state.players.forEach(p => {
      const cs = state.cricket_state.find(c => c.player_id === p.id);
      const marks = cs ? cs[`marks_${num}`] : 0;
      const closed = marks >= 3;
      html += `<td class="marks-cell ${closed ? 'closed' : ''}">${markSymbols(marks)}</td>`;
    });
    html += '</tr>';
  }

  // Bull row
  html += '<tr><td class="number-col">Bull</td>';
  state.players.forEach(p => {
    const cs = state.cricket_state.find(c => c.player_id === p.id);
    const marks = cs ? cs.marks_bull : 0;
    const closed = marks >= 3;
    html += `<td class="marks-cell ${closed ? 'closed' : ''}">${markSymbols(marks)}</td>`;
  });
  html += '</tr>';

  // Points row
  html += '<tr class="points-row"><td class="number-col">Points</td>';
  state.players.forEach(p => {
    const cs = state.cricket_state.find(c => c.player_id === p.id);
    html += `<td>${cs ? cs.points : 0}</td>`;
  });
  html += '</tr></tbody></table>';

  gridEl.innerHTML = html;
}

// Cricket input setup
document.addEventListener('DOMContentLoaded', () => {
  // Cricket number buttons
  document.querySelectorAll('.cricket-num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (cricketDarts.length >= 3) return;

      const num = btn.dataset.num;
      let dart;
      if (num === '0') {
        dart = '0';
      } else if (num === 'bull') {
        dart = cricketMultiplier === 1 ? 'SB' : 'DB';
      } else {
        const prefix = cricketMultiplier === 1 ? 'S' : cricketMultiplier === 2 ? 'D' : 'T';
        dart = prefix + num;
      }

      cricketDarts.push(dart);
      renderCricketDartsDisplay();
    });
  });

  // Cricket multiplier
  document.querySelectorAll('.cricket-mult-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.cricket-mult-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      cricketMultiplier = parseInt(btn.dataset.mult);
    });
  });

  // Confirm cricket turn
  document.getElementById('confirm-cricket-btn')?.addEventListener('click', () => {
    if (cricketDarts.length === 0 || !gameState || gameState.status !== 'in_progress') return;
    const currentPlayer = gameState.players[gameState.current_player_index];
    socket.emit('submit-turn', {
      gameId: gameState.id,
      playerId: currentPlayer.id,
      darts: [...cricketDarts]
    });
    cricketDarts = [];
    cricketMultiplier = 1;
    document.querySelectorAll('.cricket-mult-btn').forEach(b => b.classList.remove('selected'));
    document.querySelector('.cricket-mult-btn[data-mult="1"]')?.classList.add('selected');
    renderCricketDartsDisplay();
  });
});

function renderCricketDartsDisplay() {
  const container = document.getElementById('cricket-darts-thrown');
  if (!container) return;
  container.innerHTML = cricketDarts.map(d => {
    const cls = d === '0' ? 'dart-tag miss' : 'dart-tag';
    return `<span class="${cls}">${formatDart(d)}</span>`;
  }).join('');
  if (cricketDarts.length === 0) {
    container.innerHTML = '<span style="color: var(--muted)">Throw your darts...</span>';
  }
}
