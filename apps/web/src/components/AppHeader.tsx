import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export function AppHeader() {
  const { player, signOut } = useAuth();

  return (
    <header className="app-header">
      <div className="header-inner">
        <NavLink to="/" className="brand">
          <span className="brand-icon">◎</span>
          <span className="brand-text">DARTS</span>
        </NavLink>
        <nav className="header-nav">
          <NavLink to="/" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')} end>Lobby</NavLink>
          <NavLink to="/stats" className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}>Stats</NavLink>
        </nav>
        {player && (
          <div className="header-user">
            {player.avatar_url
              ? <img className="header-avatar" src={player.avatar_url} alt="" referrerPolicy="no-referrer" />
              : <span className="header-avatar-fallback" style={{ background: player.avatar_color }}>{player.name.charAt(0)}</span>
            }
            <span className="header-username">{player.name}</span>
            <button className="header-signout" onClick={() => signOut()} aria-label="Sign out">Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
