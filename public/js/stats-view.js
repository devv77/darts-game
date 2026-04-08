// Stats page
document.addEventListener('DOMContentLoaded', loadStats);

async function loadStats() {
  const container = document.getElementById('stats-container');
  const allPlayers = await API.get('/api/players');

  // Filter out AI players — stats page is for real players only
  const players = allPlayers.filter(p => !p.is_ai);

  if (players.length === 0) {
    container.innerHTML = '<p class="no-data">No players yet. Create some in the lobby!</p>';
    return;
  }

  const statsCards = await Promise.all(players.map(async p => {
    try {
      const s = await API.get(`/api/stats/players/${p.id}`);
      return `
        <div class="stats-card">
          <h3><span class="avatar" style="background:${p.avatar_color}"></span>${p.name}</h3>

          <div class="stats-section">
            <div class="stats-section-title">Overall</div>
            <div class="stat-grid">
              <div class="stat-item">
                <div class="stat-value">${s.games_played}</div>
                <div class="stat-label">Played</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.games_won}</div>
                <div class="stat-label">Won</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.win_rate}%</div>
                <div class="stat-label">Win Rate</div>
              </div>
            </div>
          </div>

          <div class="stats-section">
            <div class="stats-section-title">X01 Averages</div>
            <div class="stat-grid">
              <div class="stat-item">
                <div class="stat-value">${s.x01_average}</div>
                <div class="stat-label">3-Dart Avg</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.first_9_average}</div>
                <div class="stat-label">First 9 Avg</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.best_leg_darts || '-'}</div>
                <div class="stat-label">Best Leg</div>
              </div>
            </div>
          </div>

          <div class="stats-section">
            <div class="stats-section-title">X01 Scores</div>
            <div class="stat-grid">
              <div class="stat-item highlight-red">
                <div class="stat-value">${s.count_180}</div>
                <div class="stat-label">180s</div>
              </div>
              <div class="stat-item highlight-gold">
                <div class="stat-value">${s.count_140_plus}</div>
                <div class="stat-label">140+</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.count_100_plus}</div>
                <div class="stat-label">100+</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.highest_turn}</div>
                <div class="stat-label">Highest</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.checkout_pct}%</div>
                <div class="stat-label">Checkout %</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.bust_rate}%</div>
                <div class="stat-label">Bust Rate</div>
              </div>
            </div>
          </div>

          ${s.cricket_games_played > 0 ? `
          <div class="stats-section">
            <div class="stats-section-title">Cricket</div>
            <div class="stat-grid">
              <div class="stat-item">
                <div class="stat-value">${s.cricket_games_played}</div>
                <div class="stat-label">Played</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.cricket_games_won}</div>
                <div class="stat-label">Won</div>
              </div>
              <div class="stat-item">
                <div class="stat-value">${s.cricket_win_rate}%</div>
                <div class="stat-label">Win Rate</div>
              </div>
            </div>
          </div>` : ''}
        </div>
      `;
    } catch {
      return '';
    }
  }));

  container.innerHTML = statsCards.join('');
}
