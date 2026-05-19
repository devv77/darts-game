import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { Player } from '../types';

export function Admin() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  async function refresh() {
    try {
      const all = await api.get<Player[]>('/api/players');
      setPlayers(all);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh().catch(() => {}); }, []);

  async function deletePlayer(p: Player) {
    if (!confirm(`Delete ${p.name}? This will fail if they have an active game.`)) return;
    try {
      setBusy(true);
      await api.del(`/api/players/${p.id}`);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetAll() {
    if (!confirm('WIPE all games and human players? AI players are kept. This cannot be undone.')) return;
    if (!confirm('Are you absolutely sure? Type-equivalent of "yes I am sure" — last chance.')) return;
    try {
      setBusy(true);
      await api.del('/api/admin/reset');
      await refresh();
      alert('Reset complete.');
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const humans = players.filter((p) => !p.is_ai);
  const ais = players.filter((p) => p.is_ai);

  return (
    <>
      <AppHeader />
      <main className="lobby-main">
        <section className="card">
          <div className="card-header"><h2>All Players</h2></div>
          <div className="card-body">
            {loading ? (
              <p className="no-data">Loading…</p>
            ) : (
              <>
                <h3 className="subsection-title">Humans ({humans.length})</h3>
                <div className="player-grid">
                  {humans.map((p) => (
                    <div key={p.id} className="player-card">
                      <PlayerAvatar player={p} />
                      <span>
                        {p.name}
                        {p.google_id ? <span className="admin-badge">G</span> : <span className="admin-badge admin-badge-local">L</span>}
                      </span>
                      <button
                        className="delete-btn"
                        onClick={() => deletePlayer(p)}
                        disabled={busy}
                        aria-label="Delete"
                      >×</button>
                    </div>
                  ))}
                </div>
                {humans.length === 0 && <p className="no-data">No human players</p>}

                <h3 className="subsection-title" style={{ marginTop: '1rem' }}>AI ({ais.length})</h3>
                <div className="player-grid">
                  {ais.map((p) => (
                    <div key={p.id} className="player-card">
                      <PlayerAvatar player={p} />
                      <span>{p.name}</span>
                      <span className="admin-badge">Lv.{p.ai_level}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="card admin-danger">
          <div className="card-header"><h2>Danger Zone</h2></div>
          <div className="card-body">
            <p className="hint">
              Permanently delete all games, turns, cricket state, sessions, and human players.
              AI players are preserved.
            </p>
            <button
              className="btn btn-danger"
              onClick={resetAll}
              disabled={busy}
            >
              Reset all data
            </button>
          </div>
        </section>
      </main>
    </>
  );
}
