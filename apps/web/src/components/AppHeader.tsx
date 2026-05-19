import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';

export function AppHeader() {
  const { player, isAdmin, signOut, refresh } = useAuth();

  async function editNickname() {
    if (!player) return;
    const next = prompt('New nickname:', player.name)?.trim();
    if (!next || next === player.name) return;
    try {
      await api.put(`/api/players/${player.id}`, { name: next });
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <header className="app-header">
      <div className="header-inner">
        <NavLink to="/" className="brand">
          <img className="brand-icon" src="/brand/darts-icon.svg" alt="" />
          <span className="brand-text">DARTS</span>
        </NavLink>
        <nav className="header-nav">
          <NavLink to="/" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} end>Lobby</NavLink>
          <NavLink to="/stats" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Stats</NavLink>
          {isAdmin && (
            <NavLink to="/admin" className={({ isActive }) => 'nav-link nav-link-admin' + (isActive ? ' active' : '')}>Admin</NavLink>
          )}
        </nav>
        {player && (
          <div className="header-user">
            {player.avatar_url
              ? <img className="header-avatar" src={player.avatar_url} alt="" referrerPolicy="no-referrer" />
              : <span className="header-avatar-fallback" style={{ background: player.avatar_color }}>{player.name.charAt(0)}</span>
            }
            <button
              className="header-username header-username-edit"
              onClick={editNickname}
              title="Edit nickname"
            >
              {player.name}<span className="header-edit-pencil" aria-hidden="true">✎</span>
            </button>
            <button className="header-signout" onClick={() => signOut()} aria-label="Sign out">Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
