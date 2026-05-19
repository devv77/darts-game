import { Routes, Route, Navigate } from 'react-router-dom';
import { Lobby } from './pages/Lobby';
import { GamePage } from './pages/GamePage';
import { Stats } from './pages/Stats';
import { SignIn } from './pages/SignIn';
import { useAuth } from './contexts/AuthContext';

export function App() {
  const { player, loading } = useAuth();

  if (loading) {
    return (
      <main className="signin-main">
        <div className="signin-card">
          <span className="signin-brand-icon">◎</span>
          <p className="signin-tagline">Loading…</p>
        </div>
      </main>
    );
  }

  if (!player) {
    return (
      <Routes>
        <Route path="*" element={<SignIn />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/game" element={<GamePage />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
