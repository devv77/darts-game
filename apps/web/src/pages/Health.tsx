import { useEffect, useState } from 'react';
import { getHealth, FRONTEND_VERSION, type HealthResponse } from '../lib/health';

export function Health() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHealth().then(setHealth).catch((e) => setError((e as Error).message));
  }, []);

  const backendUp = health?.backend.status === 'ok';
  const backendVersion = health?.version ?? '—';
  // Both are built from the same commit in one image, so they should match.
  const inSync = health ? health.version === FRONTEND_VERSION : null;

  function fmtUptime(s?: number): string {
    if (!s && s !== 0) return '—';
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${m}m` : m ? `${m}m ${sec}s` : `${sec}s`;
  }

  return (
    <main className="health-main">
      <div className="health-card">
        <img className="health-logo" src="/brand/darts-logo-full.svg" alt="Darts Counter" />
        <h1 className="health-title">System Health</h1>

        <div className="health-row">
          <span className="health-label">Frontend</span>
          <span className="health-pill ok">● loaded</span>
          <code className="health-ver">{FRONTEND_VERSION}</code>
        </div>

        <div className="health-row">
          <span className="health-label">Backend</span>
          {error
            ? <span className="health-pill bad">● unreachable</span>
            : <span className={'health-pill ' + (backendUp ? 'ok' : 'bad')}>● {backendUp ? 'ok' : (health ? health.backend.status : '…')}</span>}
          <code className="health-ver">{error ? '—' : backendVersion}</code>
        </div>

        {error && <p className="health-error">{error}</p>}

        {health && (
          <>
            <div className={'health-sync ' + (inSync ? 'ok' : 'warn')}>
              {inSync ? '✓ frontend & backend versions in sync' : '⚠ version mismatch — a stale build may be deployed'}
            </div>
            <dl className="health-meta">
              <div><dt>Uptime</dt><dd>{fmtUptime(health.backend.uptimeSeconds)}</dd></div>
              <div><dt>Web bundle</dt><dd>{health.frontend.status}</dd></div>
              <div><dt>Started</dt><dd>{new Date(health.startedAt).toLocaleString()}</dd></div>
            </dl>
          </>
        )}

        <a className="health-back" href="/">← Back to app</a>
      </div>
    </main>
  );
}
