import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Game, FullGameState } from '../types';
import { AppHeader } from '../components/AppHeader';
import { ModeTile } from '../components/ModeTile';
import { useAuth } from '../contexts/AuthContext';
import { MATCH_MODES } from '../lib/modes';
import { DRILLS } from '../lib/practice';
import { FORMATS, listTournaments, type TournamentSummary } from '../lib/tournaments';

export function Home() {
  const { isAdmin } = useAuth();
  const [resumeGames, setResumeGames] = useState<{ game: Game; full: FullGameState }[]>([]);
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const navigate = useNavigate();

  async function joinByCode(e: FormEvent) {
    e.preventDefault();
    const code = joinCode.trim();
    if (!code || joining) return;
    setJoining(true);
    try {
      const game = await api.post<Game>('/api/games/join', { code });
      navigate(`/game?id=${game.id}`);
    } catch (err) {
      alert((err as Error).message);
      setJoining(false);
    }
  }

  async function refreshResume() {
    const games = await api.get<Game[]>('/api/games?status=in_progress');
    const enriched = await Promise.all(
      games.map(async (g) => ({ game: g, full: await api.get<FullGameState>(`/api/games/${g.id}`) }))
    );
    setResumeGames(enriched);
  }

  useEffect(() => {
    refreshResume().catch(() => {});
    listTournaments('in_progress')
      .then(setTournaments)
      .catch(() => {});
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

          <section className="picker-group">
            <h2 className="picker-group-title">Tournament</h2>
            <div className="mode-tile-grid">
              {FORMATS.map((f) => (
                f.available ? (
                  <ModeTile
                    key={f.format}
                    icon={f.icon}
                    name={f.name}
                    description={f.description}
                    onClick={() => navigate(`/setup?tournament=${f.format}`)}
                  />
                ) : (
                  <div key={f.format} className="mode-tile mode-tile-soon" aria-disabled="true">
                    <span className="mode-tile-icon">{f.icon}</span>
                    <span className="mode-tile-name">{f.name}</span>
                    <span className="mode-tile-desc">{f.description}</span>
                    <span className="mode-tile-soon-badge">Soon</span>
                  </div>
                )
              ))}
            </div>
          </section>
        </div>

        {tournaments.length > 0 && (
          <section className="resume-strip">
            <h2 className="picker-group-title">Active Tournaments</h2>
            {tournaments.map((t) => (
              <div key={t.id} className="resume-card">
                <span className="resume-card-mode">{t.format === 'knockout' ? '🏆' : '📊'}</span>
                <span className="resume-card-players">{t.name}</span>
                <a className="resume-card-link" href={`/tournament?id=${t.id}`}>Open</a>
              </div>
            ))}
          </section>
        )}

        <section className="join-online">
          <h2 className="picker-group-title">Join an Online Game</h2>
          <form className="join-online-form" onSubmit={joinByCode}>
            <input
              className="join-online-input"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Invite code"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              maxLength={8}
              aria-label="Invite code"
            />
            <button className="join-online-btn" type="submit" disabled={!joinCode.trim() || joining}>
              {joining ? 'Joining…' : 'Join'}
            </button>
          </form>
        </section>

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
