import type { FullGameState } from '../types';
import { formatDart } from '../lib/darts';

export function ThrowHistory({ state }: { state: FullGameState }) {
  if (state.turns.length === 0) return null;

  return (
    <div className="throw-history">
      {state.players.map((p) => {
        const playerTurns = state.turns.filter((t) => t.player_id === p.id);
        const last3 = playerTurns.slice(-3);
        const isActive = state.players[state.current_player_index]?.id === p.id && state.status === 'in_progress';
        return (
          <div key={p.id} className={'hist-player' + (isActive ? ' hist-active' : '')}>
            <div className="hist-name" style={{ borderColor: p.avatar_color }}>{p.name}</div>
            {last3.length === 0 ? (
              <div className="hist-row hist-empty">No throws yet</div>
            ) : (
              last3.map((t) => {
                const darts = [t.dart1, t.dart2, t.dart3].filter(Boolean) as string[];
                const cls = t.is_bust ? 'hist-bust' : (t.score_total >= 100 ? 'hist-ton' : '');
                return (
                  <div key={t.id} className="hist-row">
                    <span className="hist-darts">
                      {darts.map((d, i) => <span key={i} className="hist-dart">{formatDart(d)}</span>)}
                    </span>
                    <span className={'hist-score ' + cls}>{t.is_bust ? 'BUST' : t.score_total}</span>
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
