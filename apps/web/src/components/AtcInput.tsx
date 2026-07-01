import { useState } from 'react';
import { formatDart } from '../lib/darts';
import type { AtcAdvance } from '../types';

interface Props {
  currentPlayerName: string;
  /** Number now being aimed: 1..20, or 21 = bull. */
  target: number;
  advance: AtcAdvance;
  onConfirm: (darts: string[]) => void;
}

type Multiplier = 1 | 2 | 3;

export function AtcInput({ currentPlayerName, target, advance, onConfirm }: Props) {
  const [darts, setDarts] = useState<string[]>([]);
  const [mult, setMult] = useState<Multiplier>(1);

  const targetLabel = target >= 21 ? 'Bull' : String(target);

  function pushDart(num: string) {
    if (darts.length >= 3) return;
    let dart: string;
    if (num === '0') dart = '0';
    else if (num === 'bull') dart = mult === 1 ? 'SB' : 'DB';
    else dart = (mult === 1 ? 'S' : mult === 2 ? 'D' : 'T') + num;
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
    <div id="atc-input">
      <div className="current-turn-info">
        <span>{currentPlayerName}'s turn</span>
        <span className="atc-target-hint">
          Aiming <strong>{target >= 21 ? 'Bull' : targetLabel}</strong>
          {' · '}
          {advance === 'multiplier' ? 'S=+1 D=+2 T=+3' : 'exact single'}
        </span>
        <div className="darts-thrown">
          {darts.length === 0 && <span style={{ color: 'var(--muted)' }}>Throw your darts...</span>}
          {darts.map((d, i) => (
            <span key={i} className={'dart-tag' + (d === '0' ? ' miss' : '')}>{formatDart(d)}</span>
          ))}
        </div>
      </div>
      <div className="cricket-input-grid atc-input-grid">
        {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
          <button
            key={n}
            className={'cricket-num-btn' + (n === target ? ' atc-target' : '')}
            onClick={() => pushDart(String(n))}
          >
            {n}
          </button>
        ))}
        <button
          className={'cricket-num-btn' + (target >= 21 ? ' atc-target' : '')}
          onClick={() => pushDart('bull')}
        >
          Bull
        </button>
        <button className="cricket-num-btn miss-btn" onClick={() => pushDart('0')}>Miss</button>
      </div>
      <div className="multiplier-toggle">
        {[1, 2, 3].map((m) => (
          <button
            key={m}
            className={'cricket-mult-btn' + (mult === m ? ' selected' : '')}
            onClick={() => setMult(m as Multiplier)}
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
