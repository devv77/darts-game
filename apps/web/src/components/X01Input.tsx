import { useState } from 'react';
import { checkBogey, getPresets, isPossibleDoubleOut } from '../lib/suggestions';
import type { PlayerStats } from '../types';
import { DartByDartPad } from './DartByDartPad';

interface Props {
  remainingScore: number;
  currentPlayerName: string;
  stats: PlayerStats | null;
  doubleOut: boolean;
  onSubmitQuickScore: (score: number, checkoutDouble?: boolean) => void;
  onSubmitDarts: (darts: string[]) => void;
}

export function X01Input({
  remainingScore,
  currentPlayerName,
  stats,
  doubleOut,
  onSubmitQuickScore,
  onSubmitDarts,
}: Props) {
  const [isDartByDart, setIsDartByDart] = useState(false);
  const [numpadValue, setNumpadValue] = useState('');
  // A quick-entry total that exactly finishes a double-out leg — waiting for
  // the thrower to confirm the last dart was a double (the server can't tell).
  const [pendingCheckout, setPendingCheckout] = useState<number | null>(null);

  const presets = getPresets(remainingScore, stats);

  const numpadInt = numpadValue === '' ? null : parseInt(numpadValue, 10);
  const bogey = numpadInt != null ? checkBogey(remainingScore - numpadInt) : null;

  function submitQuick(val: number) {
    if (doubleOut && val === remainingScore && isPossibleDoubleOut(val)) {
      setPendingCheckout(val);
      return;
    }
    onSubmitQuickScore(val);
  }

  function resolveCheckout(onDouble: boolean) {
    if (pendingCheckout == null) return;
    onSubmitQuickScore(pendingCheckout, onDouble);
    setPendingCheckout(null);
  }

  function handleKey(key: string) {
    if (key === 'clear') {
      setNumpadValue('');
    } else if (key === 'submit') {
      const val = parseInt(numpadValue, 10);
      if (numpadValue === '' || isNaN(val) || val < 0 || val > 180) return;
      submitQuick(val);
      setNumpadValue('');
    } else {
      const next = numpadValue + key;
      if (next.length <= 3 && parseInt(next, 10) <= 180) {
        setNumpadValue(next);
      }
    }
  }

  return (
    <div id="x01-input">
      <div className="current-turn-info">
        <span>{currentPlayerName}'s turn</span>
      </div>
      {isDartByDart ? (
        <DartByDartPad
          remainingScore={remainingScore}
          doubleOut={doubleOut}
          onConfirm={onSubmitDarts}
        />
      ) : pendingCheckout != null ? (
        <div className="checkout-confirm" role="dialog" aria-label="Confirm checkout">
          <div className="checkout-confirm-title">{pendingCheckout} to finish — last dart a double?</div>
          <div className="preset-scores">
            <button className="preset-btn checkout-preset" onClick={() => resolveCheckout(true)}>
              Yes, checkout
            </button>
            <button className="preset-btn miss-preset" onClick={() => resolveCheckout(false)}>
              No — bust
            </button>
            <button className="preset-btn" onClick={() => setPendingCheckout(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="quick-input">
          <div className="preset-scores">
            {presets.map((p) => {
              let cls = 'preset-btn';
              if (p.style === 'max') cls += ' max-score';
              else if (p.style === 'ton-plus') cls += ' ton-plus';
              else if (p.style === 'ton') cls += ' ton';
              else if (p.style === 'checkout') cls += ' checkout-preset';
              else if (p.style === 'miss') cls += ' miss-preset';
              return (
                <button key={p.value} className={cls} onClick={() => submitQuick(p.value)}>
                  {p.label}
                </button>
              );
            })}
          </div>
          <div className={'custom-numpad' + (bogey ? ' bogey-warning' : '')}>
            <div className={'numpad-display' + (numpadValue === '' ? ' empty' : '')}>
              {numpadValue === '' ? 'Enter score' : (
                bogey ? `${numpadValue}  ⚠ leaves ${bogey}` : numpadValue
              )}
            </div>
            <div className="numpad-keys">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
                <button key={k} className="numpad-key" onClick={() => handleKey(k)}>{k}</button>
              ))}
              <button className="numpad-key key-clear" onClick={() => handleKey('clear')}>C</button>
              <button className="numpad-key" onClick={() => handleKey('0')}>0</button>
              <button className="numpad-key key-submit" onClick={() => handleKey('submit')}>OK</button>
            </div>
          </div>
        </div>
      )}
      <div className="input-mode-toggle">
        <button onClick={() => setIsDartByDart((v) => !v)}>
          {isDartByDart ? 'Switch to Quick Input' : 'Switch to Dart-by-Dart'}
        </button>
      </div>
    </div>
  );
}

