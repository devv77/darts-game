// Post-Match Review Screen
// Tabs: Summary, Leg Stats, Momentum Graph
// Works for x01 (501/301) and cricket modes

let reviewChartInstance = null;

function showPostMatchReview(state, winnerId) {
  const overlay = document.getElementById('post-match-overlay');
  if (!overlay) return;

  const winner = state.players.find(p => p.id === winnerId);
  document.getElementById('review-winner-text').textContent =
    (winner ? winner.name : 'Unknown') + ' Wins!';

  // Determine legs played
  const legs = getLegsPlayed(state);
  const isCricket = state.mode === 'cricket';

  // Render Summary tab
  renderMatchSummary(state, legs, isCricket);

  // Render Leg Stats tab (only for x01 with multiple legs)
  const legStatsTab = document.getElementById('review-tab-legs');
  const legStatsPanel = document.getElementById('review-legs');
  if (legs.length > 1 && !isCricket) {
    legStatsTab.hidden = false;
    renderLegStats(state, legs);
  } else {
    legStatsTab.hidden = true;
    legStatsPanel.hidden = true;
  }

  // Render Momentum tab (only for x01)
  const momentumTab = document.getElementById('review-tab-momentum');
  const momentumPanel = document.getElementById('review-momentum');
  if (!isCricket) {
    momentumTab.hidden = false;
    renderMomentumTab(state, legs);
  } else {
    momentumTab.hidden = true;
    momentumPanel.hidden = true;
  }

  // Activate summary tab
  switchReviewTab('summary');

  // Wire rematch button
  const oldBtn = document.getElementById('review-rematch-btn');
  const newBtn = oldBtn.cloneNode(true);
  oldBtn.parentNode.replaceChild(newBtn, oldBtn);
  newBtn.addEventListener('click', async () => {
    newBtn.disabled = true;
    try {
      const game = await API.post('/api/games', {
        mode: state.mode,
        player_ids: state.players.map(p => p.id),
        settings: state.parsed_settings || {}
      });
      window.location.href = '/game?id=' + game.id;
    } catch (err) {
      newBtn.disabled = false;
    }
  });

  overlay.hidden = false;
}

function switchReviewTab(tab) {
  // Tabs
  document.querySelectorAll('.review-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  // Panels
  document.querySelectorAll('.review-panel').forEach(p => {
    p.hidden = p.id !== 'review-' + tab;
  });
  // Re-render chart when momentum tab is shown (Chart.js needs visible canvas)
  if (tab === 'momentum' && window._pendingMomentumRender) {
    window._pendingMomentumRender();
    window._pendingMomentumRender = null;
  }
}

// Setup tab click handlers
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.review-tab').forEach(t => {
    t.addEventListener('click', () => {
      if (t.hidden) return;
      switchReviewTab(t.dataset.tab);
    });
  });
});

// ==================== HELPERS ====================

function getLegsPlayed(state) {
  if (!state.turns || state.turns.length === 0) return [{ set: 1, leg: 1 }];

  const legSet = new Set();
  for (const t of state.turns) {
    const s = t.set_num || 1;
    const l = t.leg_num || 1;
    legSet.add(s + ':' + l);
  }
  return Array.from(legSet).map(k => {
    const [s, l] = k.split(':').map(Number);
    return { set: s, leg: l };
  }).sort((a, b) => a.set - b.set || a.leg - b.leg);
}

function countDartsInTurn(t) {
  const d = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
  return d > 0 ? d : 3;
}

function compute3DartAvg(turns) {
  if (turns.length === 0) return 0;
  let totalScore = 0, totalDarts = 0;
  for (const t of turns) {
    totalScore += t.score_total;
    totalDarts += countDartsInTurn(t);
  }
  return totalDarts > 0 ? (totalScore / totalDarts) * 3 : 0;
}

function getLegTurns(state, setNum, legNum) {
  return state.turns.filter(t =>
    (t.set_num || 1) === setNum && (t.leg_num || 1) === legNum
  );
}

function findLegWinner(state, legTurns) {
  if (state.mode === 'cricket') return null;
  const startScore = parseInt(state.mode);
  // Build running totals per player
  const scores = {};
  state.players.forEach(p => { scores[p.id] = startScore; });
  for (const t of legTurns) {
    if (!t.is_bust) {
      scores[t.player_id] -= t.score_total;
    }
    if (scores[t.player_id] === 0) return t.player_id;
  }
  return null;
}

// ==================== SUMMARY TAB ====================

function renderMatchSummary(state, legs, isCricket) {
  const container = document.getElementById('review-summary-content');
  const startScore = parseInt(state.mode) || 0;

  const playerRows = state.players.map(p => {
    const pTurns = state.turns.filter(t => t.player_id === p.id);
    const avg = compute3DartAvg(pTurns);

    // Total darts
    let totalDarts = 0;
    for (const t of pTurns) totalDarts += countDartsInTurn(t);

    // First 9 darts avg
    const first3Turns = pTurns.slice(0, 3);
    const first9Avg = compute3DartAvg(first3Turns);

    // Highest turn
    const highest = pTurns.length > 0 ? Math.max(...pTurns.map(t => t.score_total)) : 0;

    // Milestones
    const c180 = pTurns.filter(t => t.score_total === 180).length;
    const c140 = pTurns.filter(t => t.score_total >= 140).length;
    const c100 = pTurns.filter(t => t.score_total >= 100).length;

    // Busts
    const busts = pTurns.filter(t => t.is_bust).length;

    // Checkout %: legs won / legs where they had a checkout attempt
    let legsWon = 0;
    if (!isCricket) {
      for (const leg of legs) {
        const lt = getLegTurns(state, leg.set, leg.leg);
        if (findLegWinner(state, lt) === p.id) legsWon++;
      }
    }

    // Checkout dart (last dart of won legs)
    let checkoutDarts = [];
    if (!isCricket) {
      for (const leg of legs) {
        const lt = getLegTurns(state, leg.set, leg.leg);
        if (findLegWinner(state, lt) === p.id && lt.length > 0) {
          const lastTurn = lt[lt.length - 1];
          const darts = [lastTurn.dart3, lastTurn.dart2, lastTurn.dart1].filter(Boolean);
          if (darts.length > 0) checkoutDarts.push(formatDart(darts[0]));
        }
      }
    }

    const isWinner = p.id === state.winner_id;

    let html = '<div class="review-player-card' + (isWinner ? ' winner' : '') + '">';
    html += '<div class="review-player-header" style="border-color:' + p.avatar_color + '">';
    html += '<span class="review-player-name">' + p.name + (isWinner ? ' &#127942;' : '') + '</span>';
    if (!isCricket) {
      html += '<span class="review-player-avg">' + avg.toFixed(1) + ' avg</span>';
    }
    html += '</div>';

    html += '<div class="review-stats-grid">';

    if (!isCricket) {
      html += statBox('3-Dart Avg', avg.toFixed(1));
      html += statBox('First 9', first9Avg.toFixed(1));
      html += statBox('Highest', highest);
      html += statBox('Darts', totalDarts);
      html += statBox('180s', c180, c180 > 0 ? 'highlight-red' : '');
      html += statBox('140+', c140, c140 > 0 ? 'highlight-gold' : '');
      html += statBox('100+', c100, c100 > 0 ? 'highlight-blue' : '');
      html += statBox('Busts', busts, busts > 0 ? 'highlight-muted' : '');
      if (legs.length > 1) {
        html += statBox('Legs Won', legsWon);
      }
      if (checkoutDarts.length > 0) {
        html += statBox('Checkout', checkoutDarts.join(', '));
      }
    } else {
      // Cricket summary
      const cs = state.cricket_state ? state.cricket_state.find(c => c.player_id === p.id) : null;
      const points = cs ? cs.points : 0;
      const totalMarks = cs ? (cs.marks_15 + cs.marks_16 + cs.marks_17 + cs.marks_18 + cs.marks_19 + cs.marks_20 + cs.marks_bull) : 0;
      const closedCount = cs ? [cs.marks_15, cs.marks_16, cs.marks_17, cs.marks_18, cs.marks_19, cs.marks_20, cs.marks_bull].filter(m => m >= 3).length : 0;

      html += statBox('Points', points);
      html += statBox('Total Marks', totalMarks);
      html += statBox('Closed', closedCount + '/7');
      html += statBox('Turns', pTurns.length);
      html += statBox('Darts', totalDarts);
    }

    html += '</div></div>';
    return html;
  }).join('');

  container.innerHTML = playerRows;
}

function statBox(label, value, cls) {
  return '<div class="review-stat-box' + (cls ? ' ' + cls : '') + '">' +
    '<div class="review-stat-value">' + value + '</div>' +
    '<div class="review-stat-label">' + label + '</div>' +
    '</div>';
}

// ==================== LEG STATS TAB ====================

function renderLegStats(state, legs) {
  const container = document.getElementById('review-legs-content');
  const startScore = parseInt(state.mode);

  const html = legs.map((leg, idx) => {
    const legTurns = getLegTurns(state, leg.set, leg.leg);
    const winnerId = findLegWinner(state, legTurns);
    const winner = state.players.find(p => p.id === winnerId);

    let legHtml = '<div class="review-leg-card">';
    legHtml += '<div class="review-leg-header">';
    if (legs.some(l => l.set > 1)) {
      legHtml += '<span class="review-leg-title">Set ' + leg.set + ' Leg ' + leg.leg + '</span>';
    } else {
      legHtml += '<span class="review-leg-title">Leg ' + (idx + 1) + '</span>';
    }
    if (winner) {
      legHtml += '<span class="review-leg-winner" style="color:' + winner.avatar_color + '">' + winner.name + ' &#10003;</span>';
    }
    legHtml += '</div>';

    legHtml += '<div class="review-leg-players">';
    for (const p of state.players) {
      const pTurns = legTurns.filter(t => t.player_id === p.id);
      const avg = compute3DartAvg(pTurns);
      let darts = 0;
      for (const t of pTurns) darts += countDartsInTurn(t);
      const highest = pTurns.length > 0 ? Math.max(...pTurns.map(t => t.score_total)) : 0;
      const busts = pTurns.filter(t => t.is_bust).length;
      const isLegWinner = p.id === winnerId;

      // Checkout dart
      let checkoutStr = '-';
      if (isLegWinner && pTurns.length > 0) {
        const lastTurn = pTurns[pTurns.length - 1];
        const lastDarts = [lastTurn.dart1, lastTurn.dart2, lastTurn.dart3].filter(Boolean);
        if (lastDarts.length > 0) {
          const remaining = lastDarts.reduce((s, d) => s + parseDartScore(d), 0);
          checkoutStr = remaining.toString();
        }
      }

      legHtml += '<div class="review-leg-player-row' + (isLegWinner ? ' leg-winner' : '') + '">';
      legHtml += '<span class="rlp-name" style="color:' + p.avatar_color + '">' + p.name + '</span>';
      legHtml += '<span class="rlp-stat">' + avg.toFixed(1) + '</span>';
      legHtml += '<span class="rlp-stat">' + darts + '</span>';
      legHtml += '<span class="rlp-stat">' + highest + '</span>';
      legHtml += '<span class="rlp-stat">' + busts + '</span>';
      if (isLegWinner) {
        legHtml += '<span class="rlp-stat rlp-checkout">' + checkoutStr + '</span>';
      } else {
        legHtml += '<span class="rlp-stat">-</span>';
      }
      legHtml += '</div>';
    }
    legHtml += '</div>';

    // Column headers
    const headerHtml = '<div class="review-leg-player-row header-row">' +
      '<span class="rlp-name"></span>' +
      '<span class="rlp-stat">Avg</span>' +
      '<span class="rlp-stat">Darts</span>' +
      '<span class="rlp-stat">Best</span>' +
      '<span class="rlp-stat">Busts</span>' +
      '<span class="rlp-stat">C/O</span>' +
      '</div>';

    legHtml += '</div>';

    // Insert header before players
    return legHtml.replace('<div class="review-leg-players">', '<div class="review-leg-players">' + headerHtml);
  }).join('');

  container.innerHTML = html;
}

// ==================== MOMENTUM TAB ====================

function renderMomentumTab(state, legs) {
  const container = document.getElementById('review-momentum-content');
  const startScore = parseInt(state.mode);

  // Leg selector
  let selectorHtml = '';
  if (legs.length > 1) {
    selectorHtml = '<div class="momentum-leg-selector">';
    legs.forEach((leg, idx) => {
      const label = legs.some(l => l.set > 1)
        ? 'S' + leg.set + 'L' + leg.leg
        : 'Leg ' + (idx + 1);
      selectorHtml += '<button class="momentum-leg-btn' + (idx === 0 ? ' active' : '') + '" ' +
        'data-set="' + leg.set + '" data-leg="' + leg.leg + '">' + label + '</button>';
    });
    selectorHtml += '</div>';
  }

  container.innerHTML = selectorHtml +
    '<div class="momentum-chart-container"><canvas id="momentum-chart"></canvas></div>';

  // Bind leg selector
  container.querySelectorAll('.momentum-leg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.momentum-leg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderMomentumChart(state, parseInt(btn.dataset.set), parseInt(btn.dataset.leg));
    });
  });

  // Render chart (may need to defer if tab isn't visible yet)
  const firstLeg = legs[0];
  const doRender = () => renderMomentumChart(state, firstLeg.set, firstLeg.leg);

  // If momentum tab is currently visible, render now; otherwise defer
  const panel = document.getElementById('review-momentum');
  if (!panel.hidden) {
    doRender();
  } else {
    window._pendingMomentumRender = doRender;
  }
}

function renderMomentumChart(state, setNum, legNum) {
  const canvas = document.getElementById('momentum-chart');
  if (!canvas || typeof Chart === 'undefined') return;

  // Destroy previous chart
  if (reviewChartInstance) {
    reviewChartInstance.destroy();
    reviewChartInstance = null;
  }

  const startScore = parseInt(state.mode);
  const players = state.players;
  const legTurns = getLegTurns(state, setNum, legNum);

  // Build running scores per player after each throw
  const scores = {};
  players.forEach(p => { scores[p.id] = startScore; });

  // We want a data point per "round" (all players have thrown)
  // But turns are interleaved, so we'll plot per-turn sequentially
  const labels = ['Start'];
  const datasets = players.map(p => ({
    label: p.name,
    borderColor: p.avatar_color,
    backgroundColor: p.avatar_color + '18',
    data: [startScore],
    tension: 0.3,
    pointRadius: 3,
    pointHoverRadius: 6,
    borderWidth: 2.5,
    fill: false
  }));

  // Key moment annotations
  const annotations = {};
  let turnIdx = 0;

  for (const t of legTurns) {
    if (!t.is_bust) {
      scores[t.player_id] -= t.score_total;
    }
    turnIdx++;
    const label = 'T' + turnIdx;
    labels.push(label);

    // Push current scores for all players
    players.forEach((p, i) => {
      datasets[i].data.push(scores[p.id]);
    });

    // Annotations for key moments
    const playerIdx = players.findIndex(p => p.id === t.player_id);
    if (t.score_total === 180) {
      annotations['a180_' + turnIdx] = {
        type: 'point',
        xValue: label,
        yValue: scores[t.player_id],
        backgroundColor: '#e53935',
        borderColor: '#fff',
        borderWidth: 1,
        radius: 7,
        label: {
          content: '180!',
          display: true,
          color: '#fff',
          font: { family: 'Oswald', size: 10, weight: 'bold' },
          backgroundColor: '#e53935',
          padding: 3,
          borderRadius: 3,
          position: 'top'
        }
      };
    } else if (t.score_total >= 100) {
      annotations['ton_' + turnIdx] = {
        type: 'point',
        xValue: label,
        yValue: scores[t.player_id],
        backgroundColor: '#fbbf24',
        borderColor: '#fff',
        borderWidth: 1,
        radius: 5
      };
    }

    if (t.is_bust) {
      annotations['bust_' + turnIdx] = {
        type: 'point',
        xValue: label,
        yValue: scores[t.player_id],
        backgroundColor: '#64748b',
        borderColor: '#94a3b8',
        borderWidth: 2,
        radius: 6,
        label: {
          content: 'BUST',
          display: true,
          color: '#94a3b8',
          font: { family: 'Barlow Condensed', size: 9 },
          backgroundColor: 'rgba(30,42,69,0.9)',
          padding: 2,
          borderRadius: 3,
          position: 'top'
        }
      };
    }

    // Checkout (score hit 0)
    if (scores[t.player_id] === 0) {
      annotations['checkout_' + turnIdx] = {
        type: 'point',
        xValue: label,
        yValue: 0,
        backgroundColor: '#22c55e',
        borderColor: '#fff',
        borderWidth: 2,
        radius: 8,
        label: {
          content: 'Game Shot!',
          display: true,
          color: '#fff',
          font: { family: 'Oswald', size: 10, weight: 'bold' },
          backgroundColor: '#22c55e',
          padding: 3,
          borderRadius: 3,
          position: 'top'
        }
      };
    }
  }

  const hasAnnotationPlugin = typeof Chart !== 'undefined' &&
    Chart.registry && Chart.registry.plugins &&
    Chart.registry.plugins.get('annotation');

  reviewChartInstance = new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 800, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#94a3b8',
            font: { family: 'Barlow Condensed', size: 12 },
            boxWidth: 14,
            padding: 12
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: 'rgba(18,24,40,0.95)',
          titleColor: '#f1f5f9',
          bodyColor: '#94a3b8',
          borderColor: '#334155',
          borderWidth: 1,
          titleFont: { family: 'Oswald', size: 13 },
          bodyFont: { family: 'Barlow', size: 12 },
          padding: 10,
          cornerRadius: 6,
          callbacks: {
            label: function(ctx) {
              return ctx.dataset.label + ': ' + ctx.parsed.y + ' remaining';
            }
          }
        },
        annotation: hasAnnotationPlugin ? { annotations } : undefined
      },
      scales: {
        x: {
          ticks: {
            color: '#64748b',
            font: { family: 'Barlow Condensed', size: 10 },
            maxRotation: 0
          },
          grid: { color: 'rgba(255,255,255,0.04)' }
        },
        y: {
          min: 0,
          max: startScore,
          ticks: {
            color: '#64748b',
            font: { family: 'Barlow Condensed', size: 11 },
            stepSize: startScore > 300 ? 100 : 50
          },
          grid: { color: 'rgba(255,255,255,0.06)' }
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
