import { useState } from 'react';
import { formatDart, parseDartScore, x01VisitState } from '../lib/darts';
import { checkBogey, checkoutHints } from '../lib/suggestions';

interface Props {
  remainingScore: number;
  doubleOut: boolean;
  onConfirm: (darts: string[]) => void;
}

type Multiplier = 'S' | 'D' | 'T';

export function DartByDartPad({ remainingScore, doubleOut, onConfirm }: Props) {
  const [darts, setDarts] = useState<string[]>([]);
  const [mult, setMult] = useState<Multiplier>('S');

  const subtotal = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
  const remainingAfter = remainingScore - subtotal;
  const visit = x01VisitState(remainingScore, darts, doubleOut);
  const visitOver = darts.length >= 3 || visit !== 'open';
  const bogey = doubleOut && visit === 'open' ? checkBogey(remainingAfter) : null;

  function pushDart(num: string) {
    if (visitOver) return;
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

  let hint: string | null = null;
  let hintCls = '';
  if (darts.length > 0) {
    if (visit === 'checkout') { hint = 'Game shot!'; hintCls = 'suggestion-checkout'; }
    else if (visit === 'bust') { hint = 'BUST'; hintCls = 'suggestion-safety'; }
    else if (doubleOut && remainingAfter <= 170 && remainingAfter >= 2) {
      const co = checkoutHints[remainingAfter];
      if (co) {
        const dartsLeft = 3 - darts.length;
        hint = `${dartsLeft === 1 ? 'Finish' : 'Checkout'}: ${co} (${remainingAfter} left)`;
        hintCls = 'suggestion-checkout';
      }
    }
  }

  return (
    <div className={'dart-by-dart' + (bogey && darts.length > 0 ? ' bogey-warning' : '')}>
      <div className="darts-thrown">
        {darts.length === 0 && <span style={{ color: 'var(--muted)' }}>Throw your darts...</span>}
        {darts.map((d, i) => (
          <span key={i} className={'dart-tag' + (d === '0' ? ' miss' : '')}>
            {formatDart(d)} ({parseDartScore(d)})
          </span>
        ))}
        {bogey && darts.length > 0 && (
          <span className="bogey-tag">⚠ leaves {bogey}</span>
        )}
      </div>
      {hint && (
        <div className={'suggestion-strip ' + hintCls} style={{ margin: '4px 0' }}>
          <span className="suggestion-text">{hint}</span>
        </div>
      )}
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
            <button key={n} className="num-btn" disabled={visitOver} onClick={() => pushDart(String(n))}>{n}</button>
          ))}
          <button className="num-btn bull-btn" disabled={visitOver} onClick={() => pushDart('SB')}>25</button>
          <button className="num-btn bull-btn" disabled={visitOver} onClick={() => pushDart('DB')}>50</button>
          <button className="num-btn miss-btn" disabled={visitOver} onClick={() => pushDart('0')}>Miss</button>
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
