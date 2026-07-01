import type { CSSProperties } from 'react';
import type { FullGameState } from '../types';

interface Props {
  state: FullGameState;
}

export function Scoreboard({ state }: Props) {
  if (state.mode === 'cricket') return <CricketScoreboard state={state} />;
  if (state.mode === 'atc') return <AtcScoreboard state={state} />;
  return <X01Scoreboard state={state} />;
}

function AtcScoreboard({ state }: Props) {
  return (
    <div className="scoreboard">
      {state.players.map((p, i) => {
        const a = state.atc_state?.find((s) => s.player_id === p.id);
        const isActive = i === state.current_player_index && state.status === 'in_progress';
        const target = a ? (a.completed ? '✓' : a.target >= 21 ? 'Bull' : a.target) : 1;
        return (
          <div
            key={p.id}
            className={'score-card' + (isActive ? ' active' : '')}
            style={{ ['--card-accent' as string]: p.avatar_color } as CSSProperties}
          >
            <div className="player-name">
              <span className="player-name-text">{p.name}</span>
              {!!p.is_ai && <span className="ai-tag">AI</span>}
            </div>
            <div className="player-score">{target}</div>
            <div className="player-avg">{a ? `${a.hits}/21 cleared` : 'On 1'}</div>
          </div>
        );
      })}
    </div>
  );
}

function X01Scoreboard({ state }: Props) {
  const settings = state.parsed_settings || {};
  const format = settings.format || 'single';
  const showLegs = format === 'legs' || format === 'sets';
  const showSets = format === 'sets';

  return (
    <div className="scoreboard">
      {state.players.map((p, i) => {
        const score = state.scores[p.id]!;
        const isActive = i === state.current_player_index && state.status === 'in_progress';
        const isStarting = i === state.leg_starting_player_index && state.status === 'in_progress';
        const allPlayerTurns = state.turns.filter((t) => t.player_id === p.id);
        const totalScored = allPlayerTurns.reduce((sum, t) => sum + t.score_total, 0);
        let dartsThrown = 0;
        for (const t of allPlayerTurns) {
          const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
          dartsThrown += darts > 0 ? darts : 3;
        }
        const avg = dartsThrown > 0 ? ((totalScored / dartsThrown) * 3).toFixed(1) : '-';
        return (
          <div
            key={p.id}
            className={'score-card' + (isActive ? ' active' : '')}
            style={{ ['--card-accent' as string]: p.avatar_color } as CSSProperties}
          >
            <div className="player-name">
              {isStarting && <span className="starting-indicator" title="Has the darts">🎯</span>}
              <span className="player-name-text">{p.name}</span>
              {!!p.is_ai && <span className="ai-tag">AI</span>}
            </div>
            {(showSets || showLegs) && (
              <div className="match-badges">
                {showSets && <span className="match-badge sets-badge">S {p.sets_won}</span>}
                <span className="match-badge legs-badge">L {p.legs_won}</span>
              </div>
            )}
            <div className="player-score">{score}</div>
            <div className="player-avg">Avg {avg}</div>
          </div>
        );
      })}
    </div>
  );
}

function CricketScoreboard({ state }: Props) {
  return (
    <div className="scoreboard">
      {state.players.map((p, i) => {
        const cs = state.cricket_state?.find((c) => c.player_id === p.id);
        const isActive = i === state.current_player_index && state.status === 'in_progress';
        return (
          <div
            key={p.id}
            className={'score-card' + (isActive ? ' active' : '')}
            style={{ ['--card-accent' as string]: p.avatar_color } as CSSProperties}
          >
            <div className="player-name">
              <span className="player-name-text">{p.name}</span>
              {!!p.is_ai && <span className="ai-tag">AI</span>}
            </div>
            <div className="player-score">{cs ? cs.points : 0}</div>
            <div className="player-avg">Points</div>
          </div>
        );
      })}
    </div>
  );
}
