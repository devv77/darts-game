import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';
import { Line } from 'react-chartjs-2';
import { api } from '../lib/api';
import { formatDart, parseDartScore } from '../lib/darts';
import type { FullGameState, Game, Turn } from '../types';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  annotationPlugin
);

interface Props {
  state: FullGameState;
  winnerId: number;
  onClose: () => void;
}

type Tab = 'summary' | 'legs' | 'momentum';

function getLegsPlayed(state: FullGameState): { set: number; leg: number }[] {
  if (state.turns.length === 0) return [{ set: 1, leg: 1 }];
  const legSet = new Set<string>();
  for (const t of state.turns) {
    legSet.add((t.set_num || 1) + ':' + (t.leg_num || 1));
  }
  return Array.from(legSet).map((k) => {
    const [s, l] = k.split(':').map(Number) as [number, number];
    return { set: s, leg: l };
  }).sort((a, b) => a.set - b.set || a.leg - b.leg);
}

function countDartsInTurn(t: Turn): number {
  const d = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
  return d > 0 ? d : 3;
}

function compute3DartAvg(turns: Turn[]): number {
  if (turns.length === 0) return 0;
  let totalScore = 0, totalDarts = 0;
  for (const t of turns) {
    totalScore += t.score_total;
    totalDarts += countDartsInTurn(t);
  }
  return totalDarts > 0 ? (totalScore / totalDarts) * 3 : 0;
}

function getLegTurns(state: FullGameState, setNum: number, legNum: number) {
  return state.turns.filter((t) => (t.set_num || 1) === setNum && (t.leg_num || 1) === legNum);
}

function findLegWinner(state: FullGameState, legTurns: Turn[]): number | null {
  if (state.mode === 'cricket') return null;
  const startScore = parseInt(state.mode, 10);
  const scores: Record<number, number> = {};
  for (const p of state.players) scores[p.id] = startScore;
  for (const t of legTurns) {
    if (!t.is_bust) scores[t.player_id]! -= t.score_total;
    if (scores[t.player_id] === 0) return t.player_id;
  }
  return null;
}

export function PostMatchReview({ state, winnerId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('summary');
  const [busy, setBusy] = useState(false);
  const legs = useMemo(() => getLegsPlayed(state), [state]);
  const isCricket = state.mode === 'cricket';
  const isAtc = state.mode === 'atc';
  const navigate = useNavigate();
  const winner = state.players.find((p) => p.id === winnerId);

  async function doRematch() {
    setBusy(true);
    try {
      const game = await api.post<Game>('/api/games', {
        mode: state.mode,
        player_ids: state.players.map((p) => p.id),
        settings: state.parsed_settings || {},
      });
      onClose();
      navigate(`/game?id=${game.id}`);
    } catch {
      setBusy(false);
    }
  }

  const showLegsTab = legs.length > 1 && !isCricket && !isAtc;
  const showMomentumTab = !isCricket && !isAtc;

  return (
    <div className="post-match-overlay">
      <div className="post-match-content">
        <div className="review-banner">
          <span className="review-trophy">🏆</span>
          <h1>{winner ? winner.name : 'Unknown'} Wins!</h1>
        </div>
        <div className="review-tabs">
          <button className={'review-tab' + (tab === 'summary' ? ' active' : '')} onClick={() => setTab('summary')}>Summary</button>
          {showLegsTab && (
            <button className={'review-tab' + (tab === 'legs' ? ' active' : '')} onClick={() => setTab('legs')}>Legs</button>
          )}
          {showMomentumTab && (
            <button className={'review-tab' + (tab === 'momentum' ? ' active' : '')} onClick={() => setTab('momentum')}>Momentum</button>
          )}
        </div>
        <div className="review-panels">
          {tab === 'summary' && <SummaryPanel state={state} legs={legs} isCricket={isCricket} isAtc={isAtc} />}
          {tab === 'legs' && showLegsTab && <LegStatsPanel state={state} legs={legs} />}
          {tab === 'momentum' && showMomentumTab && <MomentumPanel state={state} legs={legs} />}
        </div>
        <div className="review-actions">
          {state.tournament_id ? (
            // Inside a bracket, "Rematch" makes no sense — return to the tournament.
            <a className="review-btn review-btn-primary" href={`/tournament?id=${state.tournament_id}`}>Back to Tournament</a>
          ) : (
            <>
              <button className="review-btn review-btn-primary" onClick={doRematch} disabled={busy}>Rematch</button>
              <a className="review-btn review-btn-secondary" href="/">Back to Lobby</a>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, cls }: { label: string; value: React.ReactNode; cls?: string }) {
  return (
    <div className={'review-stat-box' + (cls ? ' ' + cls : '')}>
      <div className="review-stat-value">{value}</div>
      <div className="review-stat-label">{label}</div>
    </div>
  );
}

function SummaryPanel({ state, legs, isCricket, isAtc }: { state: FullGameState; legs: { set: number; leg: number }[]; isCricket: boolean; isAtc?: boolean }) {
  if (isAtc) {
    return (
      <div className="review-panel">
        <div>
          {state.players.map((p) => {
            const pTurns = state.turns.filter((t) => t.player_id === p.id);
            let totalDarts = 0;
            for (const t of pTurns) totalDarts += countDartsInTurn(t);
            const a = state.atc_state?.find((s) => s.player_id === p.id);
            const cleared = a ? a.hits : 0;
            const isWinner = p.id === state.winner_id;
            return (
              <div key={p.id} className={'review-player-card' + (isWinner ? ' winner' : '')}>
                <div className="review-player-header" style={{ borderColor: p.avatar_color }}>
                  <span className="review-player-name">{p.name}{isWinner && ' 🏆'}</span>
                  <span className="review-player-avg">{cleared}/21</span>
                </div>
                <div className="review-stats-grid">
                  <StatBox label="Targets" value={`${cleared}/21`} />
                  <StatBox label="Darts" value={totalDarts} />
                  <StatBox label="Turns" value={pTurns.length} />
                  <StatBox label="Finished" value={a?.completed ? '✓' : '—'} cls={a?.completed ? 'highlight-gold' : ''} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  return (
    <div className="review-panel">
      <div>
        {state.players.map((p) => {
          const pTurns = state.turns.filter((t) => t.player_id === p.id);
          const avg = compute3DartAvg(pTurns);
          let totalDarts = 0;
          for (const t of pTurns) totalDarts += countDartsInTurn(t);
          const first3 = pTurns.slice(0, 3);
          const first9Avg = compute3DartAvg(first3);
          const highest = pTurns.length > 0 ? Math.max(...pTurns.map((t) => t.score_total)) : 0;
          const c180 = pTurns.filter((t) => t.score_total === 180).length;
          const c140 = pTurns.filter((t) => t.score_total >= 140).length;
          const c100 = pTurns.filter((t) => t.score_total >= 100).length;
          const busts = pTurns.filter((t) => t.is_bust).length;
          const isWinner = p.id === state.winner_id;

          let legsWon = 0;
          let checkoutDarts: string[] = [];
          if (!isCricket) {
            for (const leg of legs) {
              const lt = getLegTurns(state, leg.set, leg.leg);
              if (findLegWinner(state, lt) === p.id) {
                legsWon++;
                if (lt.length > 0) {
                  const lastTurn = lt[lt.length - 1]!;
                  const darts = [lastTurn.dart3, lastTurn.dart2, lastTurn.dart1].filter(Boolean) as string[];
                  if (darts.length > 0) checkoutDarts.push(formatDart(darts[0]!));
                }
              }
            }
          }

          let cricketTotalMarks = 0;
          let cricketClosed = 0;
          let cricketPoints = 0;
          if (isCricket) {
            const cs = state.cricket_state?.find((c) => c.player_id === p.id);
            if (cs) {
              cricketTotalMarks = cs.marks_15 + cs.marks_16 + cs.marks_17 + cs.marks_18 + cs.marks_19 + cs.marks_20 + cs.marks_bull;
              cricketClosed = [cs.marks_15, cs.marks_16, cs.marks_17, cs.marks_18, cs.marks_19, cs.marks_20, cs.marks_bull].filter((m) => m >= 3).length;
              cricketPoints = cs.points;
            }
          }

          return (
            <div key={p.id} className={'review-player-card' + (isWinner ? ' winner' : '')}>
              <div className="review-player-header" style={{ borderColor: p.avatar_color }}>
                <span className="review-player-name">{p.name}{isWinner && ' 🏆'}</span>
                {!isCricket && <span className="review-player-avg">{avg.toFixed(1)} avg</span>}
              </div>
              <div className="review-stats-grid">
                {!isCricket ? (
                  <>
                    <StatBox label="3-Dart Avg" value={avg.toFixed(1)} />
                    <StatBox label="First 9" value={first9Avg.toFixed(1)} />
                    <StatBox label="Highest" value={highest} />
                    <StatBox label="Darts" value={totalDarts} />
                    <StatBox label="180s" value={c180} cls={c180 > 0 ? 'highlight-red' : ''} />
                    <StatBox label="140+" value={c140} cls={c140 > 0 ? 'highlight-gold' : ''} />
                    <StatBox label="100+" value={c100} cls={c100 > 0 ? 'highlight-blue' : ''} />
                    <StatBox label="Busts" value={busts} cls={busts > 0 ? 'highlight-muted' : ''} />
                    {legs.length > 1 && <StatBox label="Legs Won" value={legsWon} />}
                    {checkoutDarts.length > 0 && <StatBox label="Checkout" value={checkoutDarts.join(', ')} />}
                  </>
                ) : (
                  <>
                    <StatBox label="Points" value={cricketPoints} />
                    <StatBox label="Total Marks" value={cricketTotalMarks} />
                    <StatBox label="Closed" value={`${cricketClosed}/7`} />
                    <StatBox label="Turns" value={pTurns.length} />
                    <StatBox label="Darts" value={totalDarts} />
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LegStatsPanel({ state, legs }: { state: FullGameState; legs: { set: number; leg: number }[] }) {
  const multipleSets = legs.some((l) => l.set > 1);
  return (
    <div className="review-panel">
      <div>
        {legs.map((leg, idx) => {
          const legTurns = getLegTurns(state, leg.set, leg.leg);
          const winnerId = findLegWinner(state, legTurns);
          const winner = state.players.find((p) => p.id === winnerId);
          return (
            <div key={`${leg.set}-${leg.leg}`} className="review-leg-card">
              <div className="review-leg-header">
                <span className="review-leg-title">
                  {multipleSets ? `Set ${leg.set} Leg ${leg.leg}` : `Leg ${idx + 1}`}
                </span>
                {winner && (
                  <span className="review-leg-winner" style={{ color: winner.avatar_color }}>
                    {winner.name} ✓
                  </span>
                )}
              </div>
              <div className="review-leg-players">
                <div className="review-leg-player-row header-row">
                  <span className="rlp-name"></span>
                  <span className="rlp-stat">Avg</span>
                  <span className="rlp-stat">Darts</span>
                  <span className="rlp-stat">Best</span>
                  <span className="rlp-stat">Busts</span>
                  <span className="rlp-stat">C/O</span>
                </div>
                {state.players.map((p) => {
                  const pTurns = legTurns.filter((t) => t.player_id === p.id);
                  const avg = compute3DartAvg(pTurns);
                  let darts = 0;
                  for (const t of pTurns) darts += countDartsInTurn(t);
                  const highest = pTurns.length > 0 ? Math.max(...pTurns.map((t) => t.score_total)) : 0;
                  const busts = pTurns.filter((t) => t.is_bust).length;
                  const isLegWinner = p.id === winnerId;
                  let checkoutStr = '-';
                  if (isLegWinner && pTurns.length > 0) {
                    const lastTurn = pTurns[pTurns.length - 1]!;
                    const lastDarts = [lastTurn.dart1, lastTurn.dart2, lastTurn.dart3].filter(Boolean) as string[];
                    if (lastDarts.length > 0) {
                      const remaining = lastDarts.reduce((s, d) => s + parseDartScore(d), 0);
                      checkoutStr = remaining.toString();
                    }
                  }
                  return (
                    <div key={p.id} className={'review-leg-player-row' + (isLegWinner ? ' leg-winner' : '')}>
                      <span className="rlp-name" style={{ color: p.avatar_color }}>{p.name}</span>
                      <span className="rlp-stat">{avg.toFixed(1)}</span>
                      <span className="rlp-stat">{darts}</span>
                      <span className="rlp-stat">{highest}</span>
                      <span className="rlp-stat">{busts}</span>
                      <span className={'rlp-stat' + (isLegWinner ? ' rlp-checkout' : '')}>{isLegWinner ? checkoutStr : '-'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MomentumPanel({ state, legs }: { state: FullGameState; legs: { set: number; leg: number }[] }) {
  const [selected, setSelected] = useState(legs[0]!);
  useEffect(() => { setSelected(legs[0]!); }, [legs]);
  const multipleSets = legs.some((l) => l.set > 1);

  const startScore = parseInt(state.mode, 10) || 0;
  const legTurns = getLegTurns(state, selected.set, selected.leg);
  const scores: Record<number, number> = {};
  for (const p of state.players) scores[p.id] = startScore;

  const labels = ['Start'];
  const datasets = state.players.map((p) => ({
    label: p.name,
    borderColor: p.avatar_color,
    backgroundColor: p.avatar_color + '18',
    data: [startScore],
    tension: 0.3,
    pointRadius: 3,
    pointHoverRadius: 6,
    borderWidth: 2.5,
    fill: false,
  }));

  const annotations: Record<string, unknown> = {};
  let turnIdx = 0;
  for (const t of legTurns) {
    if (!t.is_bust) scores[t.player_id]! -= t.score_total;
    turnIdx++;
    const lbl = 'T' + turnIdx;
    labels.push(lbl);
    state.players.forEach((p, i) => {
      datasets[i]!.data.push(scores[p.id]!);
    });
    if (t.score_total === 180) {
      annotations['a180_' + turnIdx] = {
        type: 'point', xValue: lbl, yValue: scores[t.player_id],
        backgroundColor: '#e53935', borderColor: '#fff', borderWidth: 1, radius: 7,
        label: {
          content: '180!', display: true, color: '#fff',
          font: { family: 'Oswald', size: 10, weight: 'bold' },
          backgroundColor: '#e53935', padding: 3, borderRadius: 3, position: 'top',
        },
      };
    } else if (t.score_total >= 100) {
      annotations['ton_' + turnIdx] = {
        type: 'point', xValue: lbl, yValue: scores[t.player_id],
        backgroundColor: '#fbbf24', borderColor: '#fff', borderWidth: 1, radius: 5,
      };
    }
    if (t.is_bust) {
      annotations['bust_' + turnIdx] = {
        type: 'point', xValue: lbl, yValue: scores[t.player_id],
        backgroundColor: '#64748b', borderColor: '#94a3b8', borderWidth: 2, radius: 6,
        label: {
          content: 'BUST', display: true, color: '#94a3b8',
          font: { family: 'Barlow Condensed', size: 9 },
          backgroundColor: 'rgba(30,42,69,0.9)', padding: 2, borderRadius: 3, position: 'top',
        },
      };
    }
    if (scores[t.player_id] === 0) {
      annotations['checkout_' + turnIdx] = {
        type: 'point', xValue: lbl, yValue: 0,
        backgroundColor: '#22c55e', borderColor: '#fff', borderWidth: 2, radius: 8,
        label: {
          content: 'Game Shot!', display: true, color: '#fff',
          font: { family: 'Oswald', size: 10, weight: 'bold' },
          backgroundColor: '#22c55e', padding: 3, borderRadius: 3, position: 'top',
        },
      };
    }
  }

  return (
    <div className="review-panel">
      <div>
        {legs.length > 1 && (
          <div className="momentum-leg-selector">
            {legs.map((leg, idx) => (
              <button
                key={`${leg.set}-${leg.leg}`}
                className={'momentum-leg-btn' + (leg.set === selected.set && leg.leg === selected.leg ? ' active' : '')}
                onClick={() => setSelected(leg)}
              >
                {multipleSets ? `S${leg.set}L${leg.leg}` : `Leg ${idx + 1}`}
              </button>
            ))}
          </div>
        )}
        <div className="momentum-chart-container">
          <Line
            data={{ labels, datasets }}
            options={{
              responsive: true,
              maintainAspectRatio: false,
              animation: { duration: 800, easing: 'easeOutQuart' },
              plugins: {
                legend: {
                  display: true, position: 'top',
                  labels: { color: '#94a3b8', font: { family: 'Barlow Condensed', size: 12 }, boxWidth: 14, padding: 12 },
                },
                tooltip: {
                  mode: 'index', intersect: false,
                  backgroundColor: 'rgba(18,24,40,0.95)',
                  titleColor: '#f1f5f9', bodyColor: '#94a3b8',
                  borderColor: '#334155', borderWidth: 1,
                  titleFont: { family: 'Oswald', size: 13 },
                  bodyFont: { family: 'Barlow', size: 12 },
                  padding: 10, cornerRadius: 6,
                  callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y} remaining` },
                },
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                annotation: { annotations } as any,
              },
              scales: {
                x: {
                  ticks: { color: '#64748b', font: { family: 'Barlow Condensed', size: 10 }, maxRotation: 0 },
                  grid: { color: 'rgba(255,255,255,0.04)' },
                },
                y: {
                  min: 0, max: startScore,
                  ticks: { color: '#64748b', font: { family: 'Barlow Condensed', size: 11 }, stepSize: startScore > 300 ? 100 : 50 },
                  grid: { color: 'rgba(255,255,255,0.06)' },
                },
              },
              interaction: { mode: 'nearest', axis: 'x', intersect: false },
            }}
          />
        </div>
      </div>
    </div>
  );
}
