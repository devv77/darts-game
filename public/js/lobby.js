// Lobby page logic
let allPlayers = [];
let humanPlayers = [];
let aiPlayers = [];
let selectedPlayers = [];
let selectedMode = '501';
let selectedFormat = 'single';

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
      updateStartButton();
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

  // AI opponent dropdown
  document.getElementById('ai-opponent-select').addEventListener('change', updateStartButton);
}

async function loadPlayers() {
  allPlayers = await API.get('/api/players');
  humanPlayers = allPlayers.filter(p => !p.is_ai);
  aiPlayers = allPlayers.filter(p => p.is_ai);
  renderPlayerList();
  renderPlayerSelect();
  renderAiDropdown();
}

function renderPlayerList() {
  const container = document.getElementById('player-list');
  container.innerHTML = humanPlayers.map(p => `
    <div class="player-card">
      <span class="avatar" style="background:${p.avatar_color}"></span>
      <span>${p.name}</span>
      <button class="delete-btn" onclick="deletePlayer(${p.id})">&times;</button>
    </div>
  `).join('');
}

function renderPlayerSelect() {
  const container = document.getElementById('player-select');
  container.innerHTML = humanPlayers.map(p => {
    const idx = selectedPlayers.indexOf(p.id);
    const selected = idx >= 0;
    return `
      <button class="player-select-btn ${selected ? 'selected' : ''}"
              onclick="togglePlayer(${p.id})">
        <span class="avatar" style="background:${p.avatar_color}"></span>
        <span>${p.name}</span>
        <span class="order-badge">${selected ? idx + 1 : ''}</span>
      </button>
    `;
  }).join('');

  updateStartButton();
}

function renderAiDropdown() {
  const select = document.getElementById('ai-opponent-select');
  // Show one AI per level (prefer the canonical "AI - X" names)
  const byLevel = {};
  for (const p of aiPlayers) {
    if (!byLevel[p.ai_level] || p.name.startsWith('AI - ')) {
      byLevel[p.ai_level] = p;
    }
  }
  const sorted = Object.values(byLevel).sort((a, b) => a.ai_level - b.ai_level);
  select.innerHTML = '<option value="">None</option>' +
    sorted.map(p => `<option value="${p.id}">Lv.${p.ai_level} - ${p.name.replace('AI - ', '')}</option>`)
      .join('');
}

function updateStartButton() {
  const btn = document.getElementById('start-game-btn');
  const aiSelect = document.getElementById('ai-opponent-select');
  const aiId = aiSelect.value ? parseInt(aiSelect.value) : null;
  const totalPlayers = selectedPlayers.length + (aiId ? 1 : 0);
  const minPlayers = selectedMode === 'cricket' ? 1 : 2;

  btn.disabled = totalPlayers < minPlayers;
  btn.textContent = totalPlayers < minPlayers
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
  const aiSelect = document.getElementById('ai-opponent-select');
  const aiId = aiSelect.value ? parseInt(aiSelect.value) : null;
  const playerIds = [...selectedPlayers];
  if (aiId) playerIds.push(aiId);

  const minPlayers = selectedMode === 'cricket' ? 1 : 2;
  if (playerIds.length < minPlayers) return;

  try {
    const game = await API.post('/api/games', {
      mode: selectedMode,
      player_ids: playerIds,
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
