import type { Player } from '../types';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  players: Player[];
  selectedIds: number[];
  onToggle: (id: number) => void;
  /** Show 1-based order badges (multi-select match setup). */
  showOrder?: boolean;
  currentPlayerId?: number | null;
}

export function PlayerSelectGrid({ players, selectedIds, onToggle, showOrder, currentPlayerId }: Props) {
  return (
    <div className="player-select-grid">
      {players.map((p) => {
        const idx = selectedIds.indexOf(p.id);
        const selected = idx >= 0;
        return (
          <button
            key={p.id}
            className={'player-select-btn' + (selected ? ' selected' : '')}
            onClick={() => onToggle(p.id)}
          >
            <PlayerAvatar player={p} />
            <span>{p.name}{p.id === currentPlayerId ? ' (you)' : ''}</span>
            {showOrder && <span className="order-badge">{selected ? idx + 1 : ''}</span>}
          </button>
        );
      })}
    </div>
  );
}
