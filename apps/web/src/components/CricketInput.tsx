import { useState } from 'react';
import { formatDart } from '../lib/darts';

interface Props {
  currentPlayerName: string;
  onConfirm: (darts: string[]) => void;
}

export function CricketInput({ currentPlayerName, onConfirm }: Props) {
  const [darts, setDarts] = useState<string[]>([]);
  const [mult, setMult] = useState<1 | 2 | 3>(1);

  function pushDart(num: string) {
    if (darts.length >= 3) return;
    let dart: string;
    if (num === '0') dart = '0';
    else if (num === 'bull') dart = mult === 1 ? 'SB' : 'DB';
    else {
      const prefix = mult === 1 ? 'S' : mult === 2 ? 'D' : 'T';
      dart = prefix + num;
    }
    setDarts((prev) => [...prev, dart]);
  }

  function confirm() {
    if (darts.length === 0) return;
    onConfirm([...darts]);
    setDarts([]);
    setMult(1);
  }

  function undoLast() {
    setDarts((prev) => prev.slice(0, -1));
  }

  return (
    <div id="cricket-input">
      <div className="current-turn-info">
        <span>{currentPlayerName}'s turn</span>
        <div className="darts-thrown">
          {darts.length === 0 && <span style={{ color: 'var(--muted)' }}>Throw your darts...</span>}
          {darts.map((d, i) => (
            <span key={i} className={'dart-tag' + (d === '0' ? ' miss' : '')}>{formatDart(d)}</span>
          ))}
        </div>
      </div>
      <div className="cricket-input-grid">
        {[20, 19, 18, 17, 16, 15].map((n) => (
          <button key={n} className="cricket-num-btn" onClick={() => pushDart(String(n))}>{n}</button>
        ))}
        <button className="cricket-num-btn" onClick={() => pushDart('bull')}>Bull</button>
        <button className="cricket-num-btn miss-btn" onClick={() => pushDart('0')}>Miss</button>
      </div>
      <div className="multiplier-toggle">
        {[1, 2, 3].map((m) => (
          <button
            key={m}
            className={'cricket-mult-btn' + (mult === m ? ' selected' : '')}
            onClick={() => setMult(m as 1 | 2 | 3)}
          >
            {m === 1 ? 'Single' : m === 2 ? 'Double' : 'Treble'}
          </button>
        ))}
      </div>
      <div className="dart-actions">
        <button className="undo-btn" style={{ marginRight: 8 }} onClick={undoLast} disabled={darts.length === 0}>
          ← Undo Dart
        </button>
        <button className="confirm-btn" onClick={confirm} disabled={darts.length === 0}>Confirm Turn</button>
      </div>
    </div>
  );
}
