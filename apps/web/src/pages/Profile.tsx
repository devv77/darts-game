import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useAuth } from '../contexts/AuthContext';
import { isPushSupported, getPushEnabled, isSubscribed, subscribeToPush, unsubscribeFromPush } from '../lib/push';

const MAX_NAME_LENGTH = 50;

export function Profile() {
  const { player, isAdmin, refresh } = useAuth();
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [pushAvailable, setPushAvailable] = useState(false);
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [picBusy, setPicBusy] = useState(false);

  async function uploadPicture(file: File) {
    if (!player) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('That image is too large — please pick one under 5 MB.');
      return;
    }
    setPicBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      await api.upload(`/api/players/${player.id}/avatar`, form);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPicBusy(false);
    }
  }

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  useEffect(() => {
    if (!isPushSupported()) return;
    getPushEnabled().then(async (enabled) => {
      if (!enabled) return;
      setPushAvailable(true);
      setPushOn(await isSubscribed());
    });
  }, []);

  async function togglePush() {
    setPushBusy(true);
    try {
      if (pushOn) { await unsubscribeFromPush(); setPushOn(false); }
      else { await subscribeToPush(); setPushOn(true); }
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setPushBusy(false);
    }
  }

  useEffect(() => {
    if (player) {
      setName(player.name);
      setColor(player.avatar_color);
    }
  }, [player?.id, player?.name, player?.avatar_color]);

  if (!player) return null;

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME_LENGTH;
  const dirty = trimmed !== player.name || color !== player.avatar_color;

  async function save() {
    if (!player || !dirty || !valid || busy) return;
    try {
      setBusy(true);
      setSaved(false);
      await api.put(`/api/players/${player.id}`, { name: trimmed, avatar_color: color });
      await refresh();
      setSaved(true);
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="lobby-main">
        <section className="card">
          <div className="card-header"><h2>Your Profile</h2></div>
          <div className="card-body">
            <div className="profile-identity">
              <label className="avatar-upload" title="Change picture">
                <PlayerAvatar player={{ ...player, avatar_color: color }} className="profile-avatar" />
                <span className="avatar-upload-overlay">{picBusy ? '…' : '📷'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  disabled={picBusy}
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPicture(f); e.target.value = ''; }}
                />
              </label>
              <div className="profile-meta">
                <span className="profile-name">{player.name}</span>
                <span className="profile-tags">
                  {player.google_id
                    ? <span className="admin-badge">Google</span>
                    : <span className="admin-badge admin-badge-local">Local</span>}
                  {isAdmin && <span className="admin-badge">Admin</span>}
                </span>
                {player.email && <span className="profile-sub">{player.email}</span>}
                <span className="profile-sub">Member since {new Date(player.created_at).toLocaleDateString()}</span>
              </div>
            </div>
            <p className="hint">Tap your picture to change it — JPEG, PNG or WebP, max 5 MB.</p>

            <label className="profile-field">
              <span className="profile-field-label">Display name</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_NAME_LENGTH}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
                placeholder="Your name"
              />
            </label>

            <label className="profile-field">
              <span className="profile-field-label">Accent color</span>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>

            <div className="profile-actions">
              <button className="btn btn-primary" onClick={save} disabled={!dirty || !valid || busy}>
                {busy ? 'Saving…' : 'Save changes'}
              </button>
              {saved && !dirty && <span className="profile-saved">✓ Saved</span>}
            </div>

            {player.google_id && (
              <p className="hint">
                Your Google picture is used as your avatar; the accent color is the fallback and
                tints the board while it's your turn.
              </p>
            )}
          </div>
        </section>

        {pushAvailable && (
          <section className="card">
            <div className="card-header"><h2>Notifications</h2></div>
            <div className="card-body">
              <label className="online-toggle">
                <input type="checkbox" checked={pushOn} disabled={pushBusy} onChange={togglePush} />
                <span>
                  <strong>"Your turn" push</strong>
                  <small>Get a notification when it's your throw in an online game</small>
                </span>
              </label>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
