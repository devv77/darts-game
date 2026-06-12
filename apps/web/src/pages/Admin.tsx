import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import type { Player } from '../types';

export function Admin() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');

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

  async function renamePlayer(p: Player) {
    const next = prompt(`New name for ${p.name}:`, p.name)?.trim();
    if (!next || next === p.name) return;
    try {
      setBusy(true);
      await api.put(`/api/players/${p.id}`, { name: next });
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function recolorPlayer(p: Player, color: string) {
    if (color === p.avatar_color) return;
    try {
      setBusy(true);
      await api.put(`/api/players/${p.id}`, { avatar_color: color });
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleAdmin(p: Player) {
    const makeAdmin = !p.is_admin;
    if (makeAdmin && !confirm(`Grant admin rights to ${p.name}?`)) return;
    try {
      setBusy(true);
      await api.post(`/api/players/${p.id}/admin`, { isAdmin: makeAdmin });
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function uploadFor(p: Player, file: File) {
    if (file.size > 5 * 1024 * 1024) {
      alert('That image is too large — please pick one under 5 MB.');
      return;
    }
    try {
      setBusy(true);
      const form = new FormData();
      form.append('file', file);
      await api.upload(`/api/players/${p.id}/avatar`, form);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

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

  async function addLocalPlayer() {
    const name = newName.trim();
    if (!name || busy) return;
    try {
      setBusy(true);
      await api.post('/api/players', { name, avatar_color: newColor });
      setNewName('');
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

  const q = filter.trim().toLowerCase();
  const matchesFilter = (p: Player) =>
    !q || p.name.toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q);

  const humans = players.filter((p) => !p.is_ai && matchesFilter(p));
  const ais = players.filter((p) => p.is_ai && matchesFilter(p));
  const totalHumans = players.filter((p) => !p.is_ai).length;

  return (
    <>
      <AppHeader />
      <main className="lobby-main">
        <section className="card">
          <div className="card-header"><h2>All Players</h2></div>
          <div className="card-body">
            <div className="inline-form" style={{ marginBottom: '0.85rem' }}>
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Search by name or email…"
                aria-label="Search players"
              />
            </div>

            {loading ? (
              <p className="no-data">Loading…</p>
            ) : (
              <>
                <h3 className="subsection-title">Humans ({humans.length}{q ? ` / ${totalHumans}` : ''})</h3>
                <div className="player-grid">
                  {humans.map((p) => (
                    <div
                      key={p.id}
                      className="player-card"
                      title={`${p.email ?? 'local account'} · joined ${new Date(p.created_at).toLocaleDateString()}`}
                    >
                      <label className="avatar-upload avatar-upload-sm" title="Change picture">
                        <PlayerAvatar player={p} />
                        <span className="avatar-upload-overlay">📷</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          hidden
                          disabled={busy}
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFor(p, f); e.target.value = ''; }}
                        />
                      </label>
                      <span>
                        {p.name}
                        {p.is_admin ? <span className="admin-badge admin-badge-on" title="Admin">★</span> : null}
                        {p.google_id ? <span className="admin-badge">G</span> : <span className="admin-badge admin-badge-local">L</span>}
                      </span>
                      <input
                        type="color"
                        className="card-color"
                        defaultValue={p.avatar_color}
                        onBlur={(e) => recolorPlayer(p, e.target.value)}
                        disabled={busy}
                        aria-label={`Color for ${p.name}`}
                        title="Change color"
                      />
                      <button
                        className={'rename-btn' + (p.is_admin ? ' admin-on' : '')}
                        onClick={() => toggleAdmin(p)}
                        disabled={busy}
                        aria-label={p.is_admin ? 'Revoke admin' : 'Make admin'}
                        title={p.is_admin ? 'Revoke admin' : 'Make admin'}
                      >★</button>
                      <button
                        className="rename-btn"
                        onClick={() => renamePlayer(p)}
                        disabled={busy}
                        aria-label="Rename"
                        title="Rename"
                      >✎</button>
                      <button
                        className="delete-btn"
                        onClick={() => deletePlayer(p)}
                        disabled={busy}
                        aria-label="Delete"
                      >×</button>
                    </div>
                  ))}
                </div>
                {humans.length === 0 && <p className="no-data">{q ? 'No matching players' : 'No human players'}</p>}

                <div className="inline-form" style={{ marginTop: '0.5rem' }}>
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addLocalPlayer(); }}
                    placeholder="Add a local (guest) player…"
                    maxLength={50}
                    aria-label="New player name"
                  />
                  <input
                    type="color"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    aria-label="New player color"
                  />
                  <button className="btn btn-accent" onClick={addLocalPlayer} disabled={busy || !newName.trim()}>
                    Add
                  </button>
                </div>

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
                {ais.length === 0 && q && <p className="no-data">No matching AI players</p>}
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
