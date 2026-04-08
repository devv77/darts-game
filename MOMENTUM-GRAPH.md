# Momentum Graph — Post-Match Analytics

A line chart showing how the leg unfolded turn by turn, visualizing the score gap closing, lead changes, and key moments (choked checkouts, big trebles).

---

## Concept

After a match ends, the game-over overlay (and optionally the stats page for historical games) shows a line chart with:
- X axis: turn number
- Y axis: remaining score
- One line per player in their avatar color
- The lines converge toward 0 — whoever reaches it first won

Players can see exactly where someone hit a big score to catch up or choked a checkout.

---

## Data Source

Everything needed is already in the database. The `turns` table has:
```
game_id, player_id, round_num, score_total, is_bust, set_num, leg_num
```

And `getFullGameState()` already returns all turns ordered by ID. The remaining score after each turn can be computed client-side:

```javascript
// Build momentum data from game state
function buildMomentumData(state) {
  const startScore = parseInt(state.mode); // 501 or 301
  const players = state.players;
  
  // Running scores per player
  const scores = {};
  players.forEach(p => { scores[p.id] = startScore; });
  
  // Data points: [{ turn, scores: { playerId: remaining } }]
  const points = [{ turn: 0, scores: { ...scores } }];
  
  // Filter to specific leg if match play
  const legTurns = state.turns.filter(
    t => t.set_num === targetSet && t.leg_num === targetLeg
  );
  
  let turnNum = 0;
  for (const t of legTurns) {
    if (!t.is_bust) {
      scores[t.player_id] -= t.score_total;
    }
    turnNum++;
    points.push({ turn: turnNum, scores: { ...scores } });
  }
  
  return { players, points };
}
```

---

## Chart.js Integration

### Add Chart.js via CDN

In `game.html` (before other scripts):
```html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"></script>
```

No npm install needed — single CDN script, ~60KB gzipped.

### Canvas Element

Add to the game-over overlay in `game.html`:
```html
<div id="game-over-overlay" class="game-over-overlay" hidden>
  <div class="game-over-content">
    <div class="trophy">🏆</div>
    <h1 id="winner-text"></h1>
    <!-- Momentum chart -->
    <div class="momentum-chart-container">
      <canvas id="momentum-chart"></canvas>
    </div>
    <div id="game-over-stats"></div>
    <div class="game-over-actions">...</div>
  </div>
</div>
```

### Render the Chart

New file `public/js/momentum-chart.js` or add to `x01-view.js`:

```javascript
function renderMomentumChart(state) {
  const canvas = document.getElementById('momentum-chart');
  if (!canvas || typeof Chart === 'undefined') return;
  
  const startScore = parseInt(state.mode);
  const players = state.players;
  
  // Compute running scores per turn
  const scores = {};
  players.forEach(p => { scores[p.id] = startScore; });
  
  // Build datasets
  const datasets = players.map(p => ({
    label: p.name,
    borderColor: p.avatar_color,
    backgroundColor: p.avatar_color + '20',
    data: [startScore],
    tension: 0.3,
    pointRadius: 2,
    borderWidth: 2,
  }));
  
  const labels = ['Start'];
  let turnNum = 0;
  
  for (const t of state.turns) {
    if (!t.is_bust) {
      scores[t.player_id] -= t.score_total;
    }
    turnNum++;
    
    const playerIdx = players.findIndex(p => p.id === t.player_id);
    // Add data point for the player who just threw
    datasets.forEach((ds, i) => {
      ds.data.push(scores[players[i].id]);
    });
    labels.push('T' + turnNum);
  }
  
  new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#94a3b8',
            font: { family: 'Barlow Condensed', size: 11 },
            boxWidth: 12,
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
        }
      },
      scales: {
        x: {
          ticks: { color: '#64748b', font: { size: 9 } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        },
        y: {
          reverse: false,
          min: 0,
          ticks: { color: '#64748b', font: { size: 10 } },
          grid: { color: 'rgba(255,255,255,0.05)' }
        }
      },
      interaction: {
        mode: 'nearest',
        axis: 'x',
        intersect: false
      }
    }
  });
}
```

### Call it from showGameOver()

```javascript
function showGameOver(winnerId) {
  // ... existing code ...
  overlay.hidden = false;
  
  // Render momentum chart
  renderMomentumChart(gameState);
}
```

---

## CSS

```css
.momentum-chart-container {
  height: 180px;
  margin: 0.75rem 0;
  position: relative;
}

.momentum-chart-container canvas {
  width: 100% !important;
  height: 100% !important;
}
```

---

## Match Play (Sets & Legs)

For match play, show the chart for the most recent leg. Optionally add a leg selector:

```html
<div class="leg-selector">
  <button class="leg-tab active" data-set="1" data-leg="1">Set 1 Leg 1</button>
  <button class="leg-tab" data-set="1" data-leg="2">Set 1 Leg 2</button>
</div>
```

Filter turns by `set_num` and `leg_num` before building the chart data.

---

## Stats Page Integration

The same chart can be rendered on the stats page for historical games:

1. Add a "Recent Games" section to `stats.html`
2. Fetch game data via `GET /api/games/:id`
3. Render a momentum chart per game
4. Or: add a dedicated `/game/:id/recap` page with the full chart and turn-by-turn breakdown

---

## Key Moments Annotations

Chart.js supports annotations via the `chartjs-plugin-annotation` plugin. Highlight key moments:

```javascript
// Add to chart options
plugins: {
  annotation: {
    annotations: {
      ton180: {
        type: 'point',
        xValue: turnIndex,
        yValue: scoreAtTurn,
        backgroundColor: '#e53935',
        radius: 6,
        label: { content: '180!', display: true }
      }
    }
  }
}
```

Mark:
- 180s (red dot)
- Ton+ scores (gold dot)
- Busts (grey X)
- Checkout attempts (green dot on winning dart)

---

## Implementation Phases

### Phase A — Basic Chart
- Add Chart.js CDN to game.html
- Build momentum data from game state turns
- Render line chart in game-over overlay
- Player colors for lines

### Phase B — Polish
- Annotations for 180s, busts, checkout
- Smooth animations on chart render
- Legend with player names + colors

### Phase C — Stats Page
- Chart on historical game view
- Leg selector for match play
- Recent games list with mini-charts

---

## Files to Modify

| File | Change |
|------|--------|
| `public/game.html` | Chart.js CDN script tag, canvas element in game-over overlay |
| `public/js/x01-view.js` | Call `renderMomentumChart()` from `showGameOver()` |
| `public/js/momentum-chart.js` | **NEW** — chart rendering logic (~80 lines) |
| `public/css/app.css` | `.momentum-chart-container` styles |
| `public/stats.html` | (Phase C) Chart.js CDN, game history section |
