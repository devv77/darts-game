// Stats page
document.addEventListener('DOMContentLoaded', loadStats);

async function loadStats() {
  const container = document.getElementById('stats-container');
  const players = await API.get('/api/players');

  if (players.length === 0) {
    container.innerHTML = '<p class="no-data">No players yet. Create some in the lobby!</p>';
    return;
  }

  const statsCards = await Promise.all(players.map(async p => {
    try {
      const stats = await API.get(`/api/stats/players/${p.id}`);
      return `
        <div class="stats-card">
          <h3><span class="avatar" style="background:${p.avatar_color}"></span>${p.name}</h3>
          <div class="stat-grid">
            <div class="stat-item">
              <div class="stat-value">${stats.games_played}</div>
              <div class="stat-label">Games Played</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.games_won}</div>
              <div class="stat-label">Wins</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.win_rate}%</div>
              <div class="stat-label">Win Rate</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.x01_average}</div>
              <div class="stat-label">x01 Average</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.highest_turn}</div>
              <div class="stat-label">Highest Turn</div>
            </div>
            <div class="stat-item">
              <div class="stat-value">${stats.count_180}</div>
              <div class="stat-label">180s</div>
            </div>
          </div>
        </div>
      `;
    } catch {
      return '';
    }
  }));

  container.innerHTML = statsCards.join('');
}
