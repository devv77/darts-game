import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  DRILLS,
  getPracticeState,
  submitPracticeTurn,
  type PracticeState,
} from '../lib/practice';
import { announce, initVoice, triggerThrowAnimation } from '../lib/animations';
import { PracticeDartPad } from '../components/PracticeDartPad';

const ATB_LABELS = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20', 'Bull',
];

function fmtTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function PracticePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const sessionId = useMemo(() => {
    const v = params.get('id');
    return v ? parseInt(v, 10) : null;
  }, [params]);

  const [state, setState] = useState<PracticeState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const prevResultCount = useRef(0);

  useEffect(() => {
    if (sessionId === null || Number.isNaN(sessionId)) {
      navigate('/', { replace: true });
    }
  }, [sessionId, navigate]);

  useEffect(() => {
    initVoice();
  }, []);

  useEffect(() => {
    document.body.classList.add('game-page');
    return () => document.body.classList.remove('game-page');
  }, []);

  useEffect(() => {
    if (sessionId === null || Number.isNaN(sessionId)) return;
    let cancelled = false;
    getPracticeState(sessionId)
      .then((s) => {
        if (cancelled) return;
        prevResultCount.current = s.results.length;
        setState(s);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load practice session');
      });
    return () => { cancelled = true; };
  }, [sessionId]);

  function reactToNewResult(next: PracticeState) {
    const newResults = next.results.slice(prevResultCount.current);
    prevResultCount.current = next.results.length;
    if (newResults.length === 0) return;
    const latest = newResults[newResults.length - 1]!;

    if (next.drillType === 'scoring') {
      const value = latest.scoreValue ?? 0;
      if (value === 180 || value >= 100) {
        triggerThrowAnimation(value, false);
      } else {
        announce(String(value), 1.0, 1.0);
      }
    } else if (next.drillType === 'checkout' || next.drillType === 'doubles') {
      if (latest.success) {
        const targetScore = parseInt(latest.label.replace(/[^0-9]/g, ''), 10);
        triggerThrowAnimation(Number.isNaN(targetScore) ? 0 : targetScore, true);
      } else {
        triggerThrowAnimation(-1, false);
      }
    } else if (next.drillType === 'around_the_clock') {
      if (latest.success && !next.finished) {
        announce('Yes!', 1.0, 1.2);
      }
    }

    if (next.finished && next.drillType === 'around_the_clock') {
      triggerThrowAnimation(0, true);
    }
  }

  function applyTurn(promise: Promise<PracticeState>) {
    if (busy) return;
    setBusy(true);
    promise
      .then((next) => {
        reactToNewResult(next);
        setState(next);
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Turn failed');
      })
      .finally(() => setBusy(false));
  }

  function submitScore(scoreTotal: number) {
    if (sessionId === null) return;
    applyTurn(submitPracticeTurn(sessionId, { scoreTotal }));
  }

  function submitDarts(darts: string[]) {
    if (sessionId === null) return;
    applyTurn(submitPracticeTurn(sessionId, { darts }));
  }

  const drill = state ? DRILLS.find((d) => d.type === state.drillType) ?? null : null;

  if (sessionId === null || Number.isNaN(sessionId)) return null;

  if (error) {
    return (
      <>
        <header className="game-header">
          <a href="/" className="game-back">◀ Lobby</a>
          <div className="game-title">
            <span className="game-mode-badge">Practice</span>
          </div>
          <span style={{ width: 36 }} />
        </header>
        <main className="game-main">
          <div className="practice-complete">
            <p className="practice-target-hint">{error}</p>
            <button className="confirm-btn" onClick={() => navigate('/')}>Back to Lobby</button>
          </div>
        </main>
      </>
    );
  }

  if (!state || !drill) {
    return (
      <>
        <header className="game-header">
          <a href="/" className="game-back">◀ Lobby</a>
          <div className="game-title">
            <span className="game-mode-badge">Practice</span>
          </div>
          <span style={{ width: 36 }} />
        </header>
        <main className="game-main">
          <div className="game-loading">
            <span className="game-loading-dot" />
            <span className="game-loading-dot" />
            <span className="game-loading-dot" />
          </div>
        </main>
      </>
    );
  }

  const m = state.metrics;

  return (
    <>
      <header className="game-header practice-header">
        <a href="/" className="game-back">◀ Lobby</a>
        <div className="game-title">
          <span className="practice-drill-title">
            <span className="drill-icon">{drill.icon}</span>
            {drill.name}
          </span>
        </div>
        <span style={{ width: 36 }} />
      </header>

      <main className="game-main">
        {state.finished ? (
          <PracticeComplete state={state} onAgain={() => navigate('/')} onDone={() => navigate('/')} />
        ) : (
          <>
            <ProgressBlock state={state} />

            <div className="practice-target">
              <div className="practice-target-label">
                {state.targets[state.currentIndex]?.label ?? '—'}
              </div>
              {state.targets[state.currentIndex]?.hint && (
                <div className="practice-target-hint">{state.targets[state.currentIndex]!.hint}</div>
              )}
            </div>

            {state.drillType === 'around_the_clock' && <AtbTrack state={state} />}

            <MetricsStrip state={state} />

            <div className="input-area">
              {drill.input === 'numpad' ? (
                <ScoringNumpad disabled={busy} onSubmit={submitScore} />
              ) : (
                <PracticeDartPad
                  key={state.currentIndex}
                  onConfirm={submitDarts}
                  maxDarts={state.drillType === 'doubles' ? 9 : 3}
                  targetLabel={state.targets[state.currentIndex]?.label}
                />
              )}
            </div>
          </>
        )}
      </main>
    </>
  );

  // ---- inline subcomponents (declared as functions below for readability) ----
  function ProgressBlock({ state }: { state: PracticeState }) {
    const total = state.targets.length;
    const fill = total > 0 ? state.currentIndex / total : 0;
    return (
      <div className="practice-progress">
        <div className="practice-attempt">
          Target {Math.min(state.currentIndex + 1, total)} / {total}
        </div>
        <div className="practice-progress-bar">
          <div className="practice-progress-fill" style={{ width: pct(fill) }} />
        </div>
      </div>
    );
  }

  function MetricsStrip({ state }: { state: PracticeState }) {
    const metrics: { label: string; value: string }[] = [];
    if (state.drillType === 'checkout' || state.drillType === 'doubles') {
      metrics.push({ label: 'Success', value: pct(m.successRate ?? 0) });
      metrics.push({ label: 'Darts/Win', value: m.avgDartsPerSuccess != null ? m.avgDartsPerSuccess.toFixed(1) : '—' });
      metrics.push({ label: 'Done', value: `${m.targetsDone}/${m.targetsTotal}` });
    } else if (state.drillType === 'scoring') {
      metrics.push({ label: '3-Dart Avg', value: m.threeDartAvg != null ? m.threeDartAvg.toFixed(1) : '—' });
      metrics.push({ label: 'Lifetime', value: m.lifetimeAvg != null ? m.lifetimeAvg.toFixed(1) : '—' });
      metrics.push({ label: 'Round', value: `${m.targetsDone}/${m.targetsTotal}` });
    } else if (state.drillType === 'around_the_clock') {
      metrics.push({ label: 'Done', value: `${m.targetsDone}/${m.targetsTotal}` });
      metrics.push({ label: 'Darts', value: String(m.dartsThrown) });
      metrics.push({ label: 'Time', value: m.elapsedMs != null ? fmtTime(m.elapsedMs) : '—' });
    }
    return (
      <div className="practice-metrics">
        {metrics.map((x) => (
          <div key={x.label} className="practice-metric">
            <span className="practice-metric-value">{x.value}</span>
            <span className="practice-metric-label">{x.label}</span>
          </div>
        ))}
      </div>
    );
  }
}

function AtbTrack({ state }: { state: PracticeState }) {
  return (
    <div className="atb-track">
      {ATB_LABELS.map((label, i) => {
        let cls = 'atb-segment';
        if (i < state.currentIndex) cls += ' done';
        else if (i === state.currentIndex) cls += ' current';
        return (
          <span key={label} className={cls}>{label}</span>
        );
      })}
    </div>
  );
}

function ScoringNumpad({ disabled, onSubmit }: { disabled: boolean; onSubmit: (n: number) => void }) {
  const [value, setValue] = useState('');

  function handleKey(key: string) {
    if (disabled) return;
    if (key === 'clear') {
      setValue('');
    } else if (key === 'submit') {
      const val = parseInt(value, 10);
      if (value === '' || isNaN(val) || val < 0 || val > 180) return;
      onSubmit(val);
      setValue('');
    } else {
      const next = value + key;
      if (next.length <= 3 && parseInt(next, 10) <= 180) {
        setValue(next);
      }
    }
  }

  return (
    <div className="quick-input">
      <div className={'custom-numpad' + (disabled ? ' disabled' : '')}>
        <div className={'numpad-display' + (value === '' ? ' empty' : '')}>
          {value === '' ? 'Enter round score (0–180)' : value}
        </div>
        <div className="numpad-keys">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button key={k} className="numpad-key" disabled={disabled} onClick={() => handleKey(k)}>{k}</button>
          ))}
          <button className="numpad-key key-clear" disabled={disabled} onClick={() => handleKey('clear')}>C</button>
          <button className="numpad-key" disabled={disabled} onClick={() => handleKey('0')}>0</button>
          <button className="numpad-key key-submit" disabled={disabled} onClick={() => handleKey('submit')}>OK</button>
        </div>
      </div>
    </div>
  );
}

function PracticeComplete({
  state,
  onAgain,
  onDone,
}: {
  state: PracticeState;
  onAgain: () => void;
  onDone: () => void;
}) {
  const m = state.metrics;
  const drill = DRILLS.find((d) => d.type === state.drillType);
  const stats: { label: string; value: string }[] = [];

  if (state.drillType === 'checkout' || state.drillType === 'doubles') {
    stats.push({ label: 'Success Rate', value: pct(m.successRate ?? 0) });
    stats.push({ label: 'Avg Darts / Win', value: m.avgDartsPerSuccess != null ? m.avgDartsPerSuccess.toFixed(1) : '—' });
    stats.push({ label: 'Completed', value: `${m.targetsDone}/${m.targetsTotal}` });
    stats.push({ label: 'Darts Thrown', value: String(m.dartsThrown) });
  } else if (state.drillType === 'scoring') {
    stats.push({ label: '3-Dart Average', value: m.threeDartAvg != null ? m.threeDartAvg.toFixed(1) : '—' });
    stats.push({ label: 'Lifetime Average', value: m.lifetimeAvg != null ? m.lifetimeAvg.toFixed(1) : '—' });
    stats.push({ label: 'Rounds', value: `${m.targetsDone}/${m.targetsTotal}` });
  } else if (state.drillType === 'around_the_clock') {
    stats.push({ label: 'Time', value: m.elapsedMs != null ? fmtTime(m.elapsedMs) : '—' });
    stats.push({ label: 'Darts Thrown', value: String(m.dartsThrown) });
    stats.push({ label: 'Completed', value: `${m.targetsDone}/${m.targetsTotal}` });
  }

  return (
    <div className="practice-complete">
      <div className="drill-icon" style={{ fontSize: '2.6rem' }}>{drill?.icon ?? '🎯'}</div>
      <h2 className="practice-drill-title">{drill?.name ?? 'Practice'} complete</h2>
      <div className="practice-metrics">
        {stats.map((x) => (
          <div key={x.label} className="practice-metric">
            <span className="practice-metric-value">{x.value}</span>
            <span className="practice-metric-label">{x.label}</span>
          </div>
        ))}
      </div>
      <div className="dart-actions" style={{ marginTop: '1rem' }}>
        <button className="undo-btn" style={{ marginRight: 8 }} onClick={onAgain}>Practice again</button>
        <button className="confirm-btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}
