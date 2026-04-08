// Lobby page logic
let players = [];
let selectedPlayers = [];
let selectedMode = '501';
let selectedFormat = 'single';

const AI_COLORS = [
  '#22c55e', '#4ade80', '#84cc16', '#eab308', '#f59e0b',
  '#f97316', '#ef4444', '#dc2626', '#b91c1c', '#7f1d1d'
];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  await loadPlayers();
  await loadActiveGames();
  setupEventListeners();
}

function setupEventListeners() {
  document.getElementById('add-player-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('player-name').value.trim();
    const color = document.getElementById('player-color').value;
    if (!name) return;
    try {
      await API.post('/api/players', { name, avatar_color: color });
      document.getElementById('player-name').value = '';
      await loadPlayers();
    } catch (err) {
      alert(err.message);
    }
  });

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedMode = btn.dataset.mode;
      updateFormatVisibility();
      renderPlayerSelect();
    });
  });

  // Match format buttons
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedFormat = btn.dataset.format;
      updateFormatOptions();
    });
  });

  document.getElementById('start-game-btn').addEventListener('click', startGame);

  // AI player creation
  document.getElementById('add-ai-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const level = parseInt(document.getElementById('ai-level').value);
    const color = AI_COLORS[level - 1];
    const name = `AI (Lv.${level})`;
    try {
      await API.post('/api/players', { name, avatar_color: color, is_ai: true, ai_level: level });
      await loadPlayers();
    } catch (err) {
      // Handle duplicate name — append a number
      if (err.message.includes('already exists')) {
        const suffix = Math.floor(Math.random() * 99) + 1;
        try {
          await API.post('/api/players', { name: `AI #${suffix} (Lv.${level})`, avatar_color: color, is_ai: true, ai_level: level });
          await loadPlayers();
        } catch (e2) {
          alert(e2.message);
        }
      } else {
        alert(err.message);
      }
    }
  });
}

async function loadPlayers() {
  players = await API.get('/api/players');
  renderPlayerList();
  renderPlayerSelect();
}

function renderPlayerList() {
  const container = document.getElementById('player-list');
  container.innerHTML = players.map(p => {
    const aiBadge = p.is_ai ? `<span class="ai-badge">AI Lv.${p.ai_level}</span>` : '';
    const aiClass = p.is_ai ? ' ai-player' : '';
    return `
      <div class="player-card${aiClass}">
        <span class="avatar" style="background:${p.avatar_color}"></span>
        <span>${p.name}</span>
        ${aiBadge}
        <button class="delete-btn" onclick="deletePlayer(${p.id})">&times;</button>
      </div>
    `;
  }).join('');
}

function renderPlayerSelect() {
  const container = document.getElementById('player-select');
  container.innerHTML = players.map(p => {
    const idx = selectedPlayers.indexOf(p.id);
    const selected = idx >= 0;
    const aiBadge = p.is_ai ? `<span class="ai-badge-sm">AI</span>` : '';
    return `
      <button class="player-select-btn ${selected ? 'selected' : ''}"
              onclick="togglePlayer(${p.id})">
        <span class="avatar" style="background:${p.avatar_color}"></span>
        <span>${p.name}</span>
        ${aiBadge}
        <span class="order-badge">${selected ? idx + 1 : ''}</span>
      </button>
    `;
  }).join('');

  const btn = document.getElementById('start-game-btn');
  const minPlayers = selectedMode === 'cricket' ? 1 : 2;
  btn.disabled = selectedPlayers.length < minPlayers;
  btn.textContent = selectedPlayers.length < minPlayers
    ? `Select at least ${minPlayers} player${minPlayers > 1 ? 's' : ''}`
    : `Start ${selectedMode} Game`;
}

window.togglePlayer = function(id) {
  const idx = selectedPlayers.indexOf(id);
  if (idx >= 0) {
    selectedPlayers.splice(idx, 1);
  } else {
    if (selectedPlayers.length >= 4) return;
    selectedPlayers.push(id);
  }
  renderPlayerSelect();
};

window.deleteGame = async function(id) {
  if (!confirm('Abandon this game?')) return;
  try {
    await API.del(`/api/games/${id}`);
    await loadActiveGames();
  } catch (err) {
    alert(err.message);
  }
};

window.deletePlayer = async function(id) {
  if (!confirm('Delete this player?')) return;
  try {
    await API.del(`/api/players/${id}`);
    selectedPlayers = selectedPlayers.filter(pid => pid !== id);
    await loadPlayers();
  } catch (err) {
    alert(err.message);
  }
};

function updateFormatVisibility() {
  const section = document.getElementById('match-format-section');
  // Only show format options for x01 modes
  if (selectedMode === 'cricket') {
    section.hidden = true;
    selectedFormat = 'single';
  } else {
    section.hidden = false;
  }
}

function updateFormatOptions() {
  const optionsEl = document.getElementById('format-options');
  const legsEl = document.getElementById('legs-option');
  const setsEl = document.getElementById('sets-option');

  if (selectedFormat === 'single') {
    optionsEl.hidden = true;
    legsEl.hidden = true;
    setsEl.hidden = true;
  } else if (selectedFormat === 'legs') {
    optionsEl.hidden = false;
    legsEl.hidden = false;
    setsEl.hidden = true;
  } else if (selectedFormat === 'sets') {
    optionsEl.hidden = false;
    legsEl.hidden = true;
    setsEl.hidden = false;
  }
}

function getMatchSettings() {
  if (selectedFormat === 'single') {
    return { format: 'single' };
  } else if (selectedFormat === 'legs') {
    return {
      format: 'legs',
      bestOfLegs: parseInt(document.getElementById('best-of-legs').value)
    };
  } else if (selectedFormat === 'sets') {
    return {
      format: 'sets',
      bestOfSets: parseInt(document.getElementById('best-of-sets').value),
      bestOfLegsPerSet: parseInt(document.getElementById('legs-per-set').value)
    };
  }
  return { format: 'single' };
}

async function startGame() {
  const minPlayers = selectedMode === 'cricket' ? 1 : 2;
  if (selectedPlayers.length < minPlayers) return;
  try {
    const game = await API.post('/api/games', {
      mode: selectedMode,
      player_ids: selectedPlayers,
      settings: getMatchSettings()
    });
    window.location.href = `/game?id=${game.id}`;
  } catch (err) {
    alert(err.message);
  }
}

async function loadActiveGames() {
  const games = await API.get('/api/games?status=in_progress');
  const container = document.getElementById('active-games-list');
  if (games.length === 0) {
    container.innerHTML = '<p class="no-data">No active games</p>';
    return;
  }
  // Fetch player names for each game
  const gameCards = await Promise.all(games.map(async g => {
    const full = await API.get(`/api/games/${g.id}`);
    const playerNames = full.players.map(p => p.name).join(' vs ');
    return `
      <div class="game-card">
        <div class="game-info">
          <span class="game-mode">${g.mode}</span>
          <span class="game-players">${playerNames}</span>
        </div>
        <div class="game-card-actions">
          <a href="/game?id=${g.id}">Resume</a>
          <button class="game-delete-btn" onclick="deleteGame(${g.id})">&times;</button>
        </div>
      </div>
    `;
  }));
  container.innerHTML = gameCards.join('');
}
