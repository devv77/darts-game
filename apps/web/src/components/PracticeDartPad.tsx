import { useState } from 'react';
import { formatDart, parseDartScore } from '../lib/darts';

interface Props {
  onConfirm: (darts: string[]) => void;
  maxDarts?: number;
  targetLabel?: string;
}

type Multiplier = 'S' | 'D' | 'T';

export function PracticeDartPad({ onConfirm, maxDarts = 3, targetLabel }: Props) {
  const [darts, setDarts] = useState<string[]>([]);
  const [mult, setMult] = useState<Multiplier>('S');

  function pushDart(num: string) {
    if (darts.length >= maxDarts) return;
    let dart: string;
    if (num === '0') dart = '0';
    else if (num === 'SB') dart = 'SB';
    else if (num === 'DB') dart = 'DB';
    else dart = mult + num;
    setDarts((prev) => [...prev, dart]);
  }

  function confirm() {
    if (darts.length === 0) return;
    onConfirm([...darts]);
    setDarts([]);
    setMult('S');
  }

  function undoLastDart() {
    setDarts((prev) => prev.slice(0, -1));
  }

  return (
    <div className="dart-by-dart">
      <div className="darts-thrown">
        {darts.length === 0 && (
          <span style={{ color: 'var(--text-muted)' }}>
            {targetLabel ? `Aim: ${targetLabel}` : 'Throw your darts...'}
          </span>
        )}
        {darts.map((d, i) => (
          <span key={i} className={'dart-tag' + (d === '0' ? ' miss' : '')}>
            {formatDart(d)} ({parseDartScore(d)})
          </span>
        ))}
      </div>
      <div className="segment-buttons">
        <div className="multiplier-toggle">
          {(['S', 'D', 'T'] as Multiplier[]).map((m) => (
            <button
              key={m}
              className={'mult-btn' + (mult === m ? ' selected' : '')}
              onClick={() => setMult(m)}
            >
              {m === 'S' ? 'Single' : m === 'D' ? 'Double' : 'Treble'}
            </button>
          ))}
        </div>
        <div className="number-grid">
          {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
            <button key={n} className="num-btn" onClick={() => pushDart(String(n))}>{n}</button>
          ))}
          <button className="num-btn bull-btn" onClick={() => pushDart('SB')}>25</button>
          <button className="num-btn bull-btn" onClick={() => pushDart('DB')}>50</button>
          <button className="num-btn miss-btn" onClick={() => pushDart('0')}>Miss</button>
        </div>
      </div>
      <div className="dart-actions">
        <button className="undo-btn" style={{ marginRight: 8 }} onClick={undoLastDart} disabled={darts.length === 0}>
          ← Undo Dart
        </button>
        <button className="confirm-btn" onClick={confirm} disabled={darts.length === 0}>
          Confirm Turn
        </button>
      </div>
    </div>
  );
}
