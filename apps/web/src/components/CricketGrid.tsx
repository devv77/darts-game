import type { FullGameState } from '../types';

function markSymbol(count: number): string {
  if (count === 0) return '';
  if (count === 1) return '/';
  if (count === 2) return 'X';
  return 'O';
}

export function CricketGrid({ state }: { state: FullGameState }) {
  const numbers = [20, 19, 18, 17, 16, 15] as const;
  return (
    <div className="cricket-grid">
      <table className="cricket-table">
        <thead>
          <tr>
            <th></th>
            {state.players.map((p) => (
              <th key={p.id} style={{ color: p.avatar_color }}>{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {numbers.map((num) => (
            <tr key={num}>
              <td className="number-col">{num}</td>
              {state.players.map((p) => {
                const cs = state.cricket_state?.find((c) => c.player_id === p.id);
                const key = `marks_${num}` as keyof typeof cs & string;
                const marks = (cs ? (cs as unknown as Record<string, number>)[key] : 0) ?? 0;
                const closed = marks >= 3;
                return (
                  <td key={p.id} className={'marks-cell' + (closed ? ' closed' : '')}>
                    {markSymbol(marks)}
                  </td>
                );
              })}
            </tr>
          ))}
          <tr>
            <td className="number-col">Bull</td>
            {state.players.map((p) => {
              const cs = state.cricket_state?.find((c) => c.player_id === p.id);
              const marks = cs?.marks_bull ?? 0;
              const closed = marks >= 3;
              return (
                <td key={p.id} className={'marks-cell' + (closed ? ' closed' : '')}>
                  {markSymbol(marks)}
                </td>
              );
            })}
          </tr>
          <tr className="points-row">
            <td className="number-col">Points</td>
            {state.players.map((p) => {
              const cs = state.cricket_state?.find((c) => c.player_id === p.id);
              return <td key={p.id}>{cs ? cs.points : 0}</td>;
            })}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
