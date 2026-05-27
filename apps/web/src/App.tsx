import { Routes, Route, Navigate } from 'react-router-dom';
import { Home } from './pages/Home';
import { Setup } from './pages/Setup';
import { GamePage } from './pages/GamePage';
import { PracticePage } from './pages/PracticePage';
import { Stats } from './pages/Stats';
import { SignIn } from './pages/SignIn';
import { Admin } from './pages/Admin';
import { UpdatePrompt } from './components/UpdatePrompt';
import { TestModeBadge } from './components/TestModeBadge';
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
        <TestModeBadge />
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
        <TestModeBadge />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/setup" element={<Setup />} />
        <Route path="/game" element={<GamePage />} />
        <Route path="/practice" element={<PracticePage />} />
        <Route path="/stats" element={<Stats />} />
        <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <UpdatePrompt />
    </>
  );
}
