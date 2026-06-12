import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Game, GameMode, MatchFormat, MatchSettings, Player } from '../types';
import { AppHeader } from '../components/AppHeader';
import { useAuth } from '../contexts/AuthContext';
import { PlayerSelectGrid } from '../components/PlayerSelectGrid';
import { AddPlayerInline } from '../components/AddPlayerInline';
import { BullThrow } from '../components/BullThrow';
import { matchModeMeta } from '../lib/modes';
import { DRILLS, createPractice } from '../lib/practice';
import type { DrillType, Difficulty } from '../lib/practice';

const MATCH_MODES: GameMode[] = ['501', '301', 'cricket'];
const DRILL_TYPES: DrillType[] = DRILLS.map((d) => d.type);

export function Setup() {
  const { player: currentPlayer } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const rawMode = params.get('mode');
  const rawDrill = params.get('drill');
  const modeParam = MATCH_MODES.includes(rawMode as GameMode) ? (rawMode as GameMode) : null;
  const drillParam = DRILL_TYPES.includes(rawDrill as DrillType) ? (rawDrill as DrillType) : null;

  const [players, setPlayers] = useState<Player[]>([]);

  // Match state.
  const [selectedPlayerIds, setSelectedPlayerIds] = useState<number[]>(
    currentPlayer ? [currentPlayer.id] : []
  );
  const [format, setFormat] = useState<MatchFormat>('single');
  const [bestOfLegs, setBestOfLegs] = useState(5);
  const [bestOfSets, setBestOfSets] = useState(3);
  const [legsPerSet, setLegsPerSet] = useState(3);
  const [aiId, setAiId] = useState<number | ''>('');
  const [bullThrowPlayers, setBullThrowPlayers] = useState<Player[] | null>(null);
  const [creatingGame, setCreatingGame] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [onlineSlots, setOnlineSlots] = useState(2);

  // Practice state.
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [practicePlayerId, setPracticePlayerId] = useState<number | null>(
    currentPlayer ? currentPlayer.id : null
  );
  const [creatingPractice, setCreatingPractice] = useState(false);

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
  }

  useEffect(() => {
    if (!modeParam && !drillParam) {
      navigate('/', { replace: true });
      return;
    }
    refresh().catch(() => {});
  }, []);

  useEffect(() => {
    document.body.classList.add('lobby-page');
    return () => document.body.classList.remove('lobby-page');
  }, []);

  function togglePlayer(id: number) {
    setSelectedPlayerIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx >= 0) return prev.filter((p) => p !== id);
      if (prev.length >= 4) return prev;
      return [...prev, id];
    });
  }

  const totalPlayers = selectedPlayerIds.length + (aiId ? 1 : 0);
  const minPlayers = modeParam === 'cricket' ? 1 : 2;
  const canStart = isOnline ? !!currentPlayer : totalPlayers >= minPlayers;

  function buildSettings(): MatchSettings {
    const base: MatchSettings = format === 'single' ? { format: 'single' } :
      format === 'legs' ? { format: 'legs', bestOfLegs } :
      { format: 'sets', bestOfSets, bestOfLegsPerSet: legsPerSet };
    return isOnline ? { ...base, maxPlayers: onlineSlots } : base;
  }

  function selectedPlayersInOrder(): Player[] {
    const ordered: Player[] = [];
    for (const id of selectedPlayerIds) {
      const p = players.find((pl) => pl.id === id);
      if (p) ordered.push(p);
    }
    if (aiId) {
      const ai = players.find((pl) => pl.id === aiId);
      if (ai) ordered.push(ai);
    }
    return ordered;
  }

  async function createGameWithOrder(orderedPlayerIds: number[]) {
    if (!modeParam) return;
    if (!isOnline && orderedPlayerIds.length < minPlayers) return;
    setCreatingGame(true);
    try {
      const game = await api.post<Game>('/api/games', {
        mode: modeParam, player_ids: orderedPlayerIds, settings: buildSettings(), is_online: isOnline,
      });
      navigate(`/game?id=${game.id}`);
    } catch (err) {
      alert((err as Error).message);
      setCreatingGame(false);
      setBullThrowPlayers(null);
    }
  }

  function startGame() {
    // Online: the host creates with just themselves; the rest join by code, and
    // throw order is simply seat order (no bull throw for remote play in 8a).
    if (isOnline) {
      if (!currentPlayer) return;
      void createGameWithOrder([currentPlayer.id]);
      return;
    }
    const ordered = selectedPlayersInOrder();
    if (ordered.length < minPlayers) return;
    if (ordered.length < 2) {
      void createGameWithOrder(ordered.map((p) => p.id));
      return;
    }
    setBullThrowPlayers(ordered);
  }

  function handleBullThrowComplete(sortedIds: number[]) {
    void createGameWithOrder(sortedIds);
  }

  function handleBullThrowSkip() {
    const ordered = selectedPlayersInOrder();
    setBullThrowPlayers(null);
    void createGameWithOrder(ordered.map((p) => p.id));
  }

  const selectedDrillMeta = useMemo(
    () => DRILLS.find((d) => d.type === drillParam) ?? null,
    [drillParam]
  );
  const canStartPractice = drillParam !== null && practicePlayerId !== null;

  async function startPractice() {
    if (drillParam === null || practicePlayerId === null) return;
    setCreatingPractice(true);
    try {
      const s = await createPractice({
        playerId: practicePlayerId,
        drillType: drillParam,
        difficulty: selectedDrillMeta?.hasDifficulty ? difficulty : undefined,
      });
      navigate(`/practice?id=${s.id}`);
    } catch (err) {
      alert((err as Error).message);
      setCreatingPractice(false);
    }
  }

  const title = modeParam
    ? matchModeMeta(modeParam).name
    : selectedDrillMeta?.name ?? '';

  return (
    <>
      <AppHeader />
      <div className="setup-header">
        <button type="button" className="setup-back" onClick={() => navigate('/')}>
          ← Back
        </button>
        <h1 className="setup-title">{title}</h1>
      </div>

      <main className="setup-main">
        {modeParam && (
          <>
            <section className="setup-section">
              <label className="online-toggle">
                <input
                  type="checkbox"
                  checked={isOnline}
                  onChange={(e) => setIsOnline(e.target.checked)}
                />
                <span>
                  <strong>Play online</strong>
                  <small>Each player on their own device — invite by code</small>
                </span>
              </label>
            </section>

            {modeParam !== 'cricket' && (
              <section className="setup-section">
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
              </section>
            )}

            {isOnline ? (
              <section className="setup-section">
                <h3 className="subsection-title">Players</h3>
                <div className="format-buttons">
                  {[2, 3, 4].map((n) => (
                    <button
                      key={n}
                      className={'format-btn' + (onlineSlots === n ? ' selected' : '')}
                      onClick={() => setOnlineSlots(n)}
                    >
                      {n} Players
                    </button>
                  ))}
                </div>
                <p className="setup-hint">
                  You'll get an invite code to share. The match starts once everyone joins.
                </p>
              </section>
            ) : (
              <>
                <section className="setup-section">
                  <h3 className="subsection-title">Select Players</h3>
                  <PlayerSelectGrid
                    players={humans}
                    selectedIds={selectedPlayerIds}
                    onToggle={togglePlayer}
                    showOrder
                    currentPlayerId={currentPlayer?.id}
                  />
                  <AddPlayerInline onAdded={refresh} />
                </section>

                <section className="setup-section">
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
                </section>
              </>
            )}

            <button
              className="start-btn"
              disabled={!canStart || creatingGame}
              onClick={startGame}
            >
              {isOnline
                ? (creatingGame ? 'Creating…' : `Create Online ${modeParam} Game`)
                : !canStart
                  ? `Select at least ${minPlayers} player${minPlayers > 1 ? 's' : ''}`
                  : `Start ${modeParam} Game`}
            </button>
          </>
        )}

        {drillParam && (
          <>
            {selectedDrillMeta?.hasDifficulty && (
              <section className="setup-section">
                <h3 className="subsection-title">Difficulty</h3>
                <div className="difficulty-buttons">
                  {(['easy', 'medium', 'hard'] as Difficulty[]).map((lvl) => (
                    <button
                      key={lvl}
                      className={'difficulty-btn' + (difficulty === lvl ? ' selected' : '')}
                      onClick={() => setDifficulty(lvl)}
                    >
                      {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="setup-section">
              <h3 className="subsection-title">Player</h3>
              <PlayerSelectGrid
                players={humans}
                selectedIds={practicePlayerId !== null ? [practicePlayerId] : []}
                onToggle={(id) => setPracticePlayerId((prev) => (prev === id ? null : id))}
                currentPlayerId={currentPlayer?.id}
              />
              <AddPlayerInline onAdded={refresh} />
            </section>

            <button
              className="btn btn-primary"
              disabled={!canStartPractice || creatingPractice}
              onClick={startPractice}
            >
              {creatingPractice ? 'Starting…' : 'Start Practice'}
            </button>
          </>
        )}
      </main>

      {bullThrowPlayers && !creatingGame && (
        <BullThrow
          players={bullThrowPlayers}
          onComplete={handleBullThrowComplete}
          onSkip={handleBullThrowSkip}
        />
      )}
    </>
  );
}
