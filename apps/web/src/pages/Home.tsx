import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Game, FullGameState } from '../types';
import { AppHeader } from '../components/AppHeader';
import { ModeTile } from '../components/ModeTile';
import { useAuth } from '../contexts/AuthContext';
import { MATCH_MODES } from '../lib/modes';
import { DRILLS } from '../lib/practice';

export function Home() {
  const { isAdmin } = useAuth();
  const [resumeGames, setResumeGames] = useState<{ game: Game; full: FullGameState }[]>([]);
  const navigate = useNavigate();

  async function refreshResume() {
    const games = await api.get<Game[]>('/api/games?status=in_progress');
    const enriched = await Promise.all(
      games.map(async (g) => ({ game: g, full: await api.get<FullGameState>(`/api/games/${g.id}`) }))
    );
    setResumeGames(enriched);
  }

  useEffect(() => {
    refreshResume().catch(() => {});
  }, []);

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  async function deleteGame(id: number) {
    if (!confirm('Abandon this game?')) return;
    try {
      await api.del(`/api/games/${id}`);
      await refreshResume();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="home-main">
        <div className="mode-picker">
          <section className="picker-group">
            <h2 className="picker-group-title">Play a Match</h2>
            <div className="mode-tile-grid">
              {MATCH_MODES.map((m) => (
                <ModeTile
                  key={m.mode}
                  icon={m.icon}
                  name={m.name}
                  description={m.description}
                  onClick={() => navigate(`/setup?mode=${m.mode}`)}
                />
              ))}
            </div>
          </section>

          <section className="picker-group">
            <h2 className="picker-group-title">Practice</h2>
            <div className="mode-tile-grid">
              {DRILLS.map((d) => (
                <ModeTile
                  key={d.type}
                  icon={d.icon}
                  name={d.name}
                  description={d.description}
                  onClick={() => navigate(`/setup?drill=${d.type}`)}
                />
              ))}
            </div>
          </section>
        </div>

        {resumeGames.length > 0 && (
          <section className="resume-strip">
            <h2 className="picker-group-title">Resume</h2>
            {resumeGames.map(({ game, full }) => (
              <div key={game.id} className="resume-card">
                <span className="resume-card-mode">{game.mode}</span>
                <span className="resume-card-players">
                  {full.players.map((p) => p.name).join(' vs ')}
                </span>
                <a className="resume-card-link" href={`/game?id=${game.id}`}>Resume</a>
                <button className="resume-card-delete" onClick={() => deleteGame(game.id)} aria-label="Delete">×</button>
              </div>
            ))}
          </section>
        )}

        {isAdmin && (
          <nav className="home-footer-nav">
            <a href="/admin">Manage players</a>
          </nav>
        )}
      </main>
    </>
  );
}
