import { Routes, Route, Navigate } from 'react-router-dom';
import { Lobby } from './pages/Lobby';
import { GamePage } from './pages/GamePage';
import { Stats } from './pages/Stats';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Lobby />} />
      <Route path="/game" element={<GamePage />} />
      <Route path="/stats" element={<Stats />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
