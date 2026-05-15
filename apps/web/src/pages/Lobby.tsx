import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Game, GameMode, MatchFormat, MatchSettings, Player, FullGameState } from '../types';
import { AppHeader } from '../components/AppHeader';

export function Lobby() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [activeGames, setActiveGames] = useState<{ game: Game; full: FullGameState }[]>([]);
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>([]);
  const [mode, setMode] = useState<GameMode>('501');
  const [format, setFormat] = useState<MatchFormat>('single');
  const [bestOfLegs, setBestOfLegs] = useState(5);
  const [bestOfSets, setBestOfSets] = useState(3);
  const [legsPerSet, setLegsPerSet] = useState(3);
  const [aiId, setAiId] = useState<number | ''>('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const navigate = useNavigate();

  const humans = useMemo(() => players.filter((p) => !p.is_ai), [players]);
  const ais = useMemo(() => {
    const byLevel = new Map<number, Player>();
    for (const p of players.filter((x) => x.is_ai)) {
      const existing = byLevel.get(p.ai_level!);
      if (!existing || p.name.startsWith('AI - ')) byLevel.set(p.ai_level!, p);
    }
    return [...byLevel.values()].sort((a, b) => (a.ai_level || 0) - (b.ai_level || 0));
  }, [players]);

  async function refresh() {
    const all = await api.get<Player[]>('/api/players');
    setPlayers(all);
    const games = await api.get<Game[]>('/api/games?status=in_progress');
    const enriched = await Promise.all(
      games.map(async (g) => ({ game: g, full: await api.get<FullGameState>(`/api/games/${g.id}`) }))
    );
    setActiveGames(enriched);
  }

  useEffect(() => {
    refresh().catch(() => {});
  }, []);

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  useEffect(() => {
    if (mode === 'cricket') setFormat('single');
  }, [mode]);

  function togglePlayer(id: number) {
    setSelectedPlayerIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx >= 0) return prev.filter((p) => p !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  async function addPlayer(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    try {
      await api.post('/api/players', { name: newName.trim(), avatar_color: newColor });
      setNewName('');
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function deletePlayer(id: number) {
    if (!confirm('Delete this player?')) return;
    try {
      await api.del(`/api/players/${id}`);
      setSelectedPlayerIds((prev) => prev.filter((p) => p !== id));
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function deleteGame(id: number) {
    if (!confirm('Abandon this game?')) return;
    try {
      await api.del(`/api/games/${id}`);
      await refresh();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const totalPlayers = selectedPlayerIds.length + (aiId ? 1 : 0);
  const minPlayers = mode === 'cricket' ? 1 : 2;
  const canStart = totalPlayers >= minPlayers;

  async function startGame() {
    const playerIds = [...selectedPlayerIds];
    if (aiId) playerIds.push(aiId);
    if (playerIds.length < minPlayers) return;

    const settings: MatchSettings =
      format === 'single' ? { format: 'single' } :
      format === 'legs' ? { format: 'legs', bestOfLegs } :
      { format: 'sets', bestOfSets, bestOfLegsPerSet: legsPerSet };

    try {
      const game = await api.post<Game>('/api/games', {
        mode, player_ids: playerIds, settings,
      });
      navigate(`/game?id=${game.id}`);
    } catch (err) {
      alert((err as Error).message);
    }
  }

  return (
    <>
      <AppHeader />
      <main className="lobby-main">
        <section className="card">
          <div className="card-header"><h2>Players</h2></div>
          <div className="card-body">
            <div className="player-grid">
              {humans.map((p) => (
                <div key={p.id} className="player-card">
                  <span className="avatar" style={{ background: p.avatar_color }} />
                  <span>{p.name}</span>
                  <button className="delete-btn" onClick={() => deletePlayer(p.id)} aria-label="Delete">×</button>
                </div>
              ))}
            </div>
            <form className="inline-form" onSubmit={addPlayer}>
              <input
                type="text"
                placeholder="Enter player name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                required
              />
              <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
              <button type="submit" className="btn btn-primary">Add</button>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2>New Game</h2></div>
          <div className="card-body">
            <div className="game-mode-buttons">
              {(['501', '301', 'cricket'] as GameMode[]).map((m) => (
                <button
                  key={m}
                  className={'mode-btn' + (mode === m ? ' selected' : '')}
                  onClick={() => setMode(m)}
                >
                  {m === 'cricket' ? 'Cricket' : m}
                </button>
              ))}
            </div>

            {mode !== 'cricket' && (
              <div className="match-format">
                <h3 className="subsection-title">Match Format</h3>
                <div className="format-buttons">
                  {(['single', 'legs', 'sets'] as MatchFormat[]).map((f) => (
                    <button
                      key={f}
                      className={'format-btn' + (format === f ? ' selected' : '')}
                      onClick={() => setFormat(f)}
                    >
                      {f === 'single' ? 'Single Leg' : f === 'legs' ? 'Best of Legs' : 'Sets'}
                    </button>
                  ))}
                </div>
                {format === 'legs' && (
                  <div className="format-options">
                    <div className="format-option-row">
                      <label>Best of</label>
                      <select value={bestOfLegs} onChange={(e) => setBestOfLegs(parseInt(e.target.value))}>
                        {[3, 5, 7, 9, 11].map((n) => <option key={n} value={n}>{n} Legs</option>)}
                      </select>
                    </div>
                  </div>
                )}
                {format === 'sets' && (
                  <div className="format-options">
                    <div className="format-option-row">
                      <label>Best of</label>
                      <select value={bestOfSets} onChange={(e) => setBestOfSets(parseInt(e.target.value))}>
                        {[3, 5, 7].map((n) => <option key={n} value={n}>{n} Sets</option>)}
                      </select>
                      <label>Legs per set</label>
                      <select value={legsPerSet} onChange={(e) => setLegsPerSet(parseInt(e.target.value))}>
                        {[3, 5].map((n) => <option key={n} value={n}>{n} Legs</option>)}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            <h3 className="subsection-title">Select Players</h3>
            <div className="player-select-grid">
              {humans.map((p) => {
                const idx = selectedPlayerIds.indexOf(p.id);
                const selected = idx >= 0;
                return (
                  <button
                    key={p.id}
                    className={'player-select-btn' + (selected ? ' selected' : '')}
                    onClick={() => togglePlayer(p.id)}
                  >
                    <span className="avatar" style={{ background: p.avatar_color }} />
                    <span>{p.name}</span>
                    <span className="order-badge">{selected ? idx + 1 : ''}</span>
                  </button>
                );
              })}
            </div>

            <div className="ai-opponent-section">
              <h3 className="subsection-title">AI Opponent</h3>
              <select
                className="ai-select"
                value={aiId}
                onChange={(e) => setAiId(e.target.value ? parseInt(e.target.value) : '')}
              >
                <option value="">None</option>
                {ais.map((p) => (
                  <option key={p.id} value={p.id}>
                    Lv.{p.ai_level} - {p.name.replace('AI - ', '')}
                  </option>
                ))}
              </select>
            </div>

            <button
              className="start-btn"
              disabled={!canStart}
              onClick={startGame}
            >
              {!canStart
                ? `Select at least ${minPlayers} player${minPlayers > 1 ? 's' : ''}`
                : `Start ${mode} Game`}
            </button>
          </div>
        </section>

        <section className="card">
          <div className="card-header"><h2>Active Games</h2></div>
          <div className="card-body">
            {activeGames.length === 0 ? (
              <p className="no-data">No active games</p>
            ) : (
              activeGames.map(({ game, full }) => (
                <div key={game.id} className="game-card">
                  <div className="game-info">
                    <span className="game-mode">{game.mode}</span>
                    <span className="game-players">
                      {full.players.map((p) => p.name).join(' vs ')}
                    </span>
                  </div>
                  <div className="game-card-actions">
                    <a href={`/game?id=${game.id}`}>Resume</a>
                    <button className="game-delete-btn" onClick={() => deleteGame(game.id)} aria-label="Delete">×</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>
    </>
  );
}
