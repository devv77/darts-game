// Shared input pad logic for dart-by-dart entry
let currentDarts = [];
let currentMultiplier = 'S';

function initDartByDart(containerId, dartsDisplayId, confirmBtnId, onConfirm) {
  const container = document.getElementById(containerId);
  if (!container) return;

  // Multiplier buttons
  container.querySelectorAll('.mult-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.mult-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      currentMultiplier = btn.dataset.mult;
    });
  });

  // Number buttons
  container.querySelectorAll('.num-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (currentDarts.length >= 3) return;

      const num = btn.dataset.num;
      let dart;
      if (num === '0') {
        dart = '0';
      } else if (num === 'SB') {
        dart = 'SB';
      } else if (num === 'DB') {
        dart = 'DB';
      } else {
        dart = currentMultiplier + num;
      }

      currentDarts.push(dart);
      renderDartsDisplay(dartsDisplayId);
    });
  });

  // Confirm button
  document.getElementById(confirmBtnId).addEventListener('click', () => {
    if (currentDarts.length === 0) return;
    onConfirm([...currentDarts]);
    currentDarts = [];
    currentMultiplier = 'S';
    container.querySelectorAll('.mult-btn').forEach(b => b.classList.remove('selected'));
    container.querySelector('.mult-btn[data-mult="S"]')?.classList.add('selected');
    renderDartsDisplay(dartsDisplayId);
  });
}

function renderDartsDisplay(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const subtotal = currentDarts.reduce((sum, d) => sum + parseDartScore(d), 0);

  container.innerHTML = currentDarts.map(d => {
    const cls = d === '0' ? 'dart-tag miss' : 'dart-tag';
    return `<span class="${cls}">${formatDart(d)} (${parseDartScore(d)})</span>`;
  }).join('');

  if (currentDarts.length === 0) {
    container.innerHTML = '<span style="color: var(--muted)">Throw your darts...</span>';
  }

  // Bogey warning for dart-by-dart mode
  const dartArea = document.getElementById('dart-by-dart-area');
  if (dartArea && typeof checkBogey === 'function' && typeof gameState !== 'undefined' && gameState && gameState.status === 'in_progress') {
    const currentPlayer = gameState.players[gameState.current_player_index];
    const score = gameState.scores[currentPlayer.id];
    const remaining = score - subtotal;
    const bogey = checkBogey(remaining);
    if (bogey && currentDarts.length > 0) {
      dartArea.classList.add('bogey-warning');
      container.innerHTML += `<span class="bogey-tag">⚠ leaves ${bogey}</span>`;
    } else {
      dartArea.classList.remove('bogey-warning');
    }
  }
}

function resetDartInput() {
  currentDarts = [];
  currentMultiplier = 'S';
}
