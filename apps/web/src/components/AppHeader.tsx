import { NavLink } from 'react-router-dom';

export function AppHeader() {
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
      </div>
    </header>
  );
}
