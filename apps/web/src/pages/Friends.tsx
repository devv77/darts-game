import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import {
  getFriends, inviteFriend, acceptFriend, removeFriend,
  type FriendsView, type FriendEntry,
} from '../lib/friends';

export function Friends() {
  const navigate = useNavigate();
  const [view, setView] = useState<FriendsView | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = () => getFriends().then(setView).catch(() => {});
  useEffect(() => { refresh(); }, []);

  async function invite(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || busy) return;
    setBusy(true);
    try {
      await inviteFriend(q);
      setQuery('');
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await refresh(); } catch (err) { alert((err as Error).message); }
  }

  const Row = ({ e, actions }: { e: FriendEntry; actions: React.ReactNode }) => (
    <div className="friend-row">
      <span className="friend-id">
        <PlayerAvatar player={e.player} />
        <span className={'presence-dot' + (e.online ? ' online' : '')} title={e.online ? 'Online' : 'Offline'} />
        <span>{e.player.name}</span>
      </span>
      <span className="friend-actions">{actions}</span>
    </div>
  );

  return (
    <>
      <AppHeader />
      <div className="setup-header">
        <button type="button" className="setup-back" onClick={() => navigate('/')}>← Home</button>
        <h1 className="setup-title">Friends</h1>
      </div>
      <main className="setup-main">
        <section className="setup-section">
          <h3 className="subsection-title">Add a Friend</h3>
          <form className="join-online-form" onSubmit={invite}>
            <input
              className="tournament-name-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or email"
            />
            <button className="join-online-btn" type="submit" disabled={!query.trim() || busy}>
              {busy ? '…' : 'Invite'}
            </button>
          </form>
        </section>

        {view && view.incoming.length > 0 && (
          <section className="setup-section">
            <h3 className="subsection-title">Requests</h3>
            {view.incoming.map((e) => (
              <Row key={e.player.id} e={e} actions={
                <>
                  <button className="friend-accept" onClick={() => act(() => acceptFriend(e.player.id))}>Accept</button>
                  <button className="friend-remove" onClick={() => act(() => removeFriend(e.player.id))}>✕</button>
                </>
              } />
            ))}
          </section>
        )}

        <section className="setup-section">
          <h3 className="subsection-title">Friends {view && <span className="roster-count">{view.friends.length}</span>}</h3>
          {view?.friends.length === 0 && <p className="setup-hint">No friends yet — invite someone above.</p>}
          {view?.friends.map((e) => (
            <Row key={e.player.id} e={e} actions={
              <button className="friend-remove" onClick={() => act(() => removeFriend(e.player.id))}>Remove</button>
            } />
          ))}
        </section>

        {view && view.outgoing.length > 0 && (
          <section className="setup-section">
            <h3 className="subsection-title">Sent</h3>
            {view.outgoing.map((e) => (
              <Row key={e.player.id} e={e} actions={
                <button className="friend-remove" onClick={() => act(() => removeFriend(e.player.id))}>Cancel</button>
              } />
            ))}
          </section>
        )}
      </main>
    </>
  );
}
