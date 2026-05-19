import { Routes, Route, Navigate } from 'react-router-dom';
import { Lobby } from './pages/Lobby';
import { GamePage } from './pages/GamePage';
import { Stats } from './pages/Stats';
import { SignIn } from './pages/SignIn';
import { Admin } from './pages/Admin';
import { UpdatePrompt } from './components/UpdatePrompt';
import { useAuth } from './contexts/AuthContext';

export function App() {
  const { player, isAdmin, loading } = useAuth();

  if (loading) {
    return (
      <>
        <main className="signin-main">
          <div className="signin-card">
            <img className="signin-logo" src="/brand/darts-logo-full.svg" alt="Darts Counter" />
            <p className="signin-tagline">Loading…</p>
          </div>
        </main>
        <UpdatePrompt />
      </>
    );
  }

  if (!player) {
    return (
      <>
        <Routes>
          <Route path="*" element={<SignIn />} />
        </Routes>
        <UpdatePrompt />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Lobby />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdatePrompt />
    </>
  );
}
