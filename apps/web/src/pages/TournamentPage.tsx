import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { AppHeader } from '../components/AppHeader';
import { PlayerAvatar } from '../components/PlayerAvatar';
import { useAuth } from '../contexts/AuthContext';
import { getSocket } from '../lib/socket';
import {
  getTournament, launchTournamentMatch, simulateTournamentMatch, deleteTournament, startTournament, roundName,
  type TournamentState, type TournamentMatch, type TournamentPlayerInfo, type StandingsRow,
} from '../lib/tournaments';
import type { Player } from '../types';

type Tab = 'bracket' | 'table' | 'groups' | 'fixtures';

export function TournamentPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { player: me, isAdmin } = useAuth();
  const id = useMemo(() => {
    const v = params.get('id');
    return v ? parseInt(v, 10) : null;
  }, [params]);

  const [state, setState] = useState<TournamentState | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Initial value resolves to each format's primary tab via `effectiveTab`
  // (knockout→Bracket, league→Table, groups→Groups) until the user switches.
  const [tab, setTab] = useState<Tab>('groups');
  const [launching, setLaunching] = useState<number | null>(null);
  const firedConfetti = useRef(false);

  const refetch = useCallback(() => {
    if (id == null) return;
    getTournament(id).then(setState).catch((e) => setError((e as Error).message));
  }, [id]);

  useEffect(() => {
    if (id == null || Number.isNaN(id)) { navigate('/', { replace: true }); return; }
    refetch();
  }, [id, navigate, refetch]);

  // Live updates: subscribe to the tournament room and refetch on any change.
  useEffect(() => {
    if (id == null) return;
    const socket = getSocket();
    const join = () => socket.emit('join-tournament', { tournamentId: id });
    const onUpdated = (p: { tournamentId: number }) => { if (p.tournamentId === id) refetch(); };
    join();
    socket.on('connect', join);
    socket.on('tournament-updated', onUpdated);
    return () => {
      socket.emit('leave-tournament', { tournamentId: id });
      socket.off('connect', join);
      socket.off('tournament-updated', onUpdated);
    };
  }, [id, refetch]);

  const playerMap = useMemo(() => {
    const m = new Map<number, TournamentPlayerInfo>();
    state?.players.forEach((p) => m.set(p.player.id, p));
    return m;
  }, [state]);

  const totalRounds = useMemo(() => {
    if (!state) return 0;
    return state.matches.reduce((max, mt) => Math.max(max, mt.roundNum), 0);
  }, [state]);

  const isOrganiser = !!state && (isAdmin || state.createdBy === me?.id);
  const completed = state?.status === 'completed';

  useEffect(() => {
    if (completed && !firedConfetti.current) {
      firedConfetti.current = true;
      const end = Date.now() + 1200;
      const colors = ['#fbbf24', '#e53935', '#22c55e', '#3b82f6', '#ffffff'];
      (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 }, colors, disableForReducedMotion: true });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 }, colors, disableForReducedMotion: true });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    }
  }, [completed]);

  async function launch(m: TournamentMatch) {
    if (m.gameId) { navigate(`/game?id=${m.gameId}`); return; }
    setLaunching(m.id);
    try {
      const { gameId } = await launchTournamentMatch(m.tournamentId, m.id);
      navigate(`/game?id=${gameId}`);
    } catch (err) {
      alert((err as Error).message);
      setLaunching(null);
    }
  }

  const [simulating, setSimulating] = useState<number | null>(null);
  async function simulate(m: TournamentMatch) {
    setSimulating(m.id);
    try {
      setState(await simulateTournamentMatch(m.tournamentId, m.id));
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSimulating(null);
    }
  }

  async function abandon() {
    if (!state || !confirm('Delete this tournament? Scheduled matches will be removed.')) return;
    try {
      await deleteTournament(state.id);
      navigate('/');
    } catch (err) {
      alert((err as Error).message);
    }
  }

  const [starting, setStarting] = useState(false);
  async function start() {
    if (!state) return;
    setStarting(true);
    try {
      setState(await startTournament(state.id));
    } catch (err) {
      alert((err as Error).message);
      setStarting(false);
    }
  }

  if (error) {
    return (
      <>
        <AppHeader />
        <main className="tournament-main"><p className="tournament-error">{error}</p></main>
      </>
    );
  }
  if (!state) {
    return (
      <>
        <AppHeader />
        <main className="tournament-main"><div className="game-loading"><span className="game-loading-dot" /><span className="game-loading-dot" /><span className="game-loading-dot" /></div></main>
      </>
    );
  }

  const nameOf = (pid: number | null): string => {
    if (pid === null) return 'TBD';
    return playerMap.get(pid)?.player.name ?? '—';
  };
  const playerOf = (pid: number | null): Player | null => playerMap.get(pid ?? -1)?.player ?? null;

  const champion = completed && state.winnerId !== null ? playerOf(state.winnerId) : null;
  const isLeague = state.format === 'league';
  const isGroups = state.format === 'groups_knockout';
  const iAmInMatch = (m: TournamentMatch) => !!me && (m.homePlayerId === me.id || m.awayPlayerId === me.id);
  const canLaunchMatch = (m: TournamentMatch) => isOrganiser || (state.isOnline && iAmInMatch(m));
  const isAllAiMatch = (m: TournamentMatch) =>
    !!playerMap.get(m.homePlayerId ?? -1)?.player.is_ai && !!playerMap.get(m.awayPlayerId ?? -1)?.player.is_ai;
  // Organiser-only convenience: instantly play out an all-AI tie.
  const canSimulate = (m: TournamentMatch) => isOrganiser && isAllAiMatch(m);

  // Split by stage — group matchdays and KO rounds both use round_num, so the
  // bracket/fixtures must not lump them together.
  const koMatches = state.matches.filter((m) => m.stage === 'ko');
  const leagueMatches = state.matches.filter((m) => m.stage === 'league');
  const groupMatches = state.matches.filter((m) => m.stage === 'group');
  const koRounds = koMatches.reduce((max, m) => Math.max(max, m.roundNum), 0);
  const bracketRounds = groupByRound(koMatches);

  // Tab set depends on format: knockout→Bracket, league→Table, groups→Groups+Bracket.
  const primaryTabs: { key: Tab; label: string }[] = isLeague
    ? [{ key: 'table', label: 'Table' }]
    : isGroups
      ? [{ key: 'groups', label: 'Groups' }, { key: 'bracket', label: 'Bracket' }]
      : [{ key: 'bracket', label: 'Bracket' }];
  const allTabs: { key: Tab; label: string }[] = [...primaryTabs, { key: 'fixtures', label: 'Fixtures' }];
  const effectiveTab: Tab = allTabs.some((t) => t.key === tab) ? tab : primaryTabs[0]!.key;

  if (state.status === 'setup') {
    return (
      <>
        <AppHeader />
        <div className="tournament-header">
          <button type="button" className="setup-back" onClick={() => navigate('/')}>← Home</button>
          <div className="tournament-title-wrap">
            <h1 className="tournament-title">{state.name}</h1>
            <span className="tournament-sub">{state.mode.toUpperCase()} · Knockout · Lobby</span>
          </div>
          {isOrganiser && <button type="button" className="tournament-delete" onClick={abandon} aria-label="Delete">🗑</button>}
        </div>
        <main className="tournament-main">
          <section className="online-wait">
            <p className="online-wait-title">Waiting for players…</p>
            <p className="online-wait-sub">
              {state.players.length}{state.targetSize ? ` of ${state.targetSize}` : ''} joined
            </p>
            {state.inviteCode && (
              <div className="invite-code-box">
                <span className="invite-code-label">Share this code</span>
                <span className="invite-code-value">{state.inviteCode}</span>
              </div>
            )}
          </section>
          <section className="lobby-players">
            {state.players
              .slice()
              .sort((a, b) => a.seed - b.seed)
              .map((p) => (
                <div className="lobby-player" key={p.player.id}>
                  <span className="lobby-seed">{p.seed}</span>
                  <PlayerAvatar player={p.player} />
                  <span>{p.player.name}{p.player.id === me?.id ? ' (you)' : ''}</span>
                </div>
              ))}
          </section>
          {isOrganiser && (
            <button className="start-btn" disabled={starting || state.players.length < 2} onClick={start}>
              {starting ? 'Starting…' : state.players.length < 2 ? 'Waiting for opponents…' : `Start with ${state.players.length}`}
            </button>
          )}
        </main>
      </>
    );
  }

  return (
    <>
      <AppHeader />
      <div className="tournament-header">
        <button type="button" className="setup-back" onClick={() => navigate('/')}>← Home</button>
        <div className="tournament-title-wrap">
          <h1 className="tournament-title">{state.name}</h1>
          <span className="tournament-sub">
            {state.mode.toUpperCase()} · {state.players.length} players · {isLeague ? 'League' : 'Knockout'}
          </span>
        </div>
        {isOrganiser && (
          <button type="button" className="tournament-delete" onClick={abandon} aria-label="Delete tournament">🗑</button>
        )}
      </div>

      {champion && (
        <section className="champion-banner">
          <div className="champion-trophy">🏆</div>
          <div className="champion-label">Champion</div>
          <div className="champion-name">
            <PlayerAvatar player={champion} />
            <span>{champion.name}</span>
          </div>
          <div className="champion-cta">
            <button className="btn btn-primary" onClick={() => navigate(`/setup?tournament=${state.format}`)}>New Tournament</button>
            <button className="btn" onClick={() => navigate('/')}>Home</button>
          </div>
        </section>
      )}

      <div className="tournament-tabs">
        {allTabs.map((t) => (
          <button
            key={t.key}
            className={'tournament-tab' + (effectiveTab === t.key ? ' active' : '')}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      <main className="tournament-main">
        {effectiveTab === 'table' && state.standings && (
          <div className="standings">
            <table className="standings-table">
              <thead>
                <tr>
                  <th>#</th><th className="standings-name-col">Player</th>
                  <th>P</th><th>W</th><th>L</th><th>+/−</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {state.standings.map((row, i) => {
                  const p = playerOf(row.playerId);
                  return (
                    <tr key={row.playerId} className={i === 0 && completed ? 'standings-champ' : ''}>
                      <td>{i + 1}</td>
                      <td className="standings-name-col">
                        {p && <PlayerAvatar player={p} />}
                        <span>{nameOf(row.playerId)}</span>
                      </td>
                      <td>{row.played}</td><td>{row.won}</td><td>{row.lost}</td>
                      <td>{row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}</td>
                      <td className="standings-pts">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="standings-footer">Tiebreak: points → leg difference → legs for → seed</p>
          </div>
        )}

        {effectiveTab === 'groups' && state.groupStandings && (
          <div className="groups-grid">
            {state.groupStandings.map((g) => (
              <div className="group-card" key={g.group}>
                <h3 className="group-title">Group {g.group}</h3>
                <StandingsMini rows={g.rows} nameOf={nameOf} playerOf={playerOf}
                  advance={state.options.advancePerGroup ?? 2} />
              </div>
            ))}
          </div>
        )}

        {effectiveTab === 'table' && state.standings && (
          <div className="standings">
            <table className="standings-table">
              <thead>
                <tr>
                  <th>#</th><th className="standings-name-col">Player</th>
                  <th>P</th><th>W</th><th>L</th><th>+/−</th><th>Pts</th>
                </tr>
              </thead>
              <tbody>
                {state.standings.map((row, i) => {
                  const p = playerOf(row.playerId);
                  return (
                    <tr key={row.playerId} className={i === 0 && completed ? 'standings-champ' : ''}>
                      <td>{i + 1}</td>
                      <td className="standings-name-col">
                        {p && <PlayerAvatar player={p} />}
                        <span>{nameOf(row.playerId)}</span>
                      </td>
                      <td>{row.played}</td><td>{row.won}</td><td>{row.lost}</td>
                      <td>{row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}</td>
                      <td className="standings-pts">{row.points}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="standings-footer">Tiebreak: points → leg difference → legs for → seed</p>
          </div>
        )}

        {effectiveTab === 'bracket' && (
          koMatches.length === 0 ? (
            <p className="setup-hint" style={{ textAlign: 'center' }}>The knockout bracket is drawn once the group stage finishes.</p>
          ) : (
            <div className="bracket-scroll">
              <div className="bracket">
                {bracketRounds.map(({ roundNum, matches }) => (
                  <div className="bracket-round" key={roundNum}>
                    <div className="bracket-round-title">{roundName(roundNum, koRounds)}</div>
                    <div className="bracket-round-matches">
                      {matches.map((m) => (
                        <div className={'bracket-match status-' + m.status} key={m.id}>
                          <BracketSlot
                            player={playerOf(m.homePlayerId)} name={nameOf(m.homePlayerId)}
                            legs={m.homeLegs} winner={m.winnerId !== null && m.winnerId === m.homePlayerId}
                            seed={playerMap.get(m.homePlayerId ?? -1)?.seed}
                          />
                          <BracketSlot
                            player={playerOf(m.awayPlayerId)} name={m.status === 'bye' ? 'Bye' : nameOf(m.awayPlayerId)}
                            legs={m.awayLegs} winner={m.winnerId !== null && m.winnerId === m.awayPlayerId}
                            seed={playerMap.get(m.awayPlayerId ?? -1)?.seed}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        )}

        {effectiveTab === 'fixtures' && (
          <div className="fixtures">
            {/* League: by matchday. Knockout: by round. Groups: per-group matchdays, then KO. */}
            {isLeague && groupByRound(leagueMatches).map(({ roundNum, matches }) => (
              <FixtureSection key={`md${roundNum}`} title={`Matchday ${roundNum}`} matches={matches}
                nameOf={nameOf} canLaunchMatch={canLaunchMatch} launch={launch} launching={launching}
                canSimulate={canSimulate} simulate={simulate} simulating={simulating} />
            ))}
            {isGroups && groupFixtureSections(groupMatches).map(({ key, title, matches }) => (
              <FixtureSection key={key} title={title} matches={matches}
                nameOf={nameOf} canLaunchMatch={canLaunchMatch} launch={launch} launching={launching}
                canSimulate={canSimulate} simulate={simulate} simulating={simulating} />
            ))}
            {bracketRounds.map(({ roundNum, matches }) => (
              <FixtureSection key={`ko${roundNum}`} title={roundName(roundNum, koRounds)} matches={matches}
                nameOf={nameOf} canLaunchMatch={canLaunchMatch} launch={launch} launching={launching}
                canSimulate={canSimulate} simulate={simulate} simulating={simulating} />
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function StandingsMini({ rows, nameOf, playerOf, advance }: {
  rows: StandingsRow[]; nameOf: (id: number | null) => string; playerOf: (id: number | null) => Player | null; advance: number;
}) {
  return (
    <table className="standings-table standings-mini">
      <thead>
        <tr><th>#</th><th className="standings-name-col">Player</th><th>P</th><th>+/−</th><th>Pts</th></tr>
      </thead>
      <tbody>
        {rows.map((row, i) => {
          const p = playerOf(row.playerId);
          return (
            <tr key={row.playerId} className={i < advance ? 'standings-qualify' : ''}>
              <td>{i + 1}</td>
              <td className="standings-name-col">{p && <PlayerAvatar player={p} />}<span>{nameOf(row.playerId)}</span></td>
              <td>{row.played}</td>
              <td>{row.legDiff > 0 ? `+${row.legDiff}` : row.legDiff}</td>
              <td className="standings-pts">{row.points}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function FixtureSection({ title, matches, nameOf, canLaunchMatch, launch, launching, canSimulate, simulate, simulating }: {
  title: string; matches: TournamentMatch[];
  nameOf: (id: number | null) => string;
  canLaunchMatch: (m: TournamentMatch) => boolean;
  launch: (m: TournamentMatch) => void;
  launching: number | null;
  canSimulate: (m: TournamentMatch) => boolean;
  simulate: (m: TournamentMatch) => void;
  simulating: number | null;
}) {
  return (
    <section className="fixtures-round">
      <h3 className="fixtures-round-title">{title}</h3>
      {matches.map((m) => (
        <div className={'fixture-row status-' + m.status} key={m.id}>
          <span className="fixture-players">
            <span className={m.winnerId === m.homePlayerId ? 'fixture-winner' : ''}>{nameOf(m.homePlayerId)}</span>
            <span className="fixture-vs">vs</span>
            <span className={m.winnerId === m.awayPlayerId ? 'fixture-winner' : ''}>
              {m.status === 'bye' ? 'Bye' : nameOf(m.awayPlayerId)}
            </span>
          </span>
          <span className="fixture-action">
            {m.status === 'completed' && <span className="fixture-score">{m.homeLegs}–{m.awayLegs}</span>}
            {m.status === 'bye' && <span className="fixture-bye">Walkover</span>}
            {m.status === 'ready' && (
              canSimulate(m)
                ? <button className="fixture-sim" disabled={simulating === m.id} onClick={() => simulate(m)}>{simulating === m.id ? '…' : '⚡ Sim'}</button>
                : canLaunchMatch(m)
                  ? <button className="fixture-play" disabled={launching === m.id} onClick={() => launch(m)}>{launching === m.id ? '…' : '▶ Play'}</button>
                  : <span className="fixture-wait">Ready</span>
            )}
            {m.status === 'in_progress' && (
              canLaunchMatch(m)
                ? <button className="fixture-play" onClick={() => launch(m)}>Resume</button>
                : <span className="fixture-wait">In play</span>
            )}
            {m.status === 'pending' && <span className="fixture-wait">Awaiting players</span>}
          </span>
        </div>
      ))}
    </section>
  );
}

/** Group fixtures split by group label then matchday. */
function groupFixtureSections(groupMatches: TournamentMatch[]): { key: string; title: string; matches: TournamentMatch[] }[] {
  const out: { key: string; title: string; matches: TournamentMatch[] }[] = [];
  const groups = [...new Set(groupMatches.map((m) => m.groupLabel ?? ''))].sort();
  for (const g of groups) {
    const inGroup = groupMatches.filter((m) => (m.groupLabel ?? '') === g);
    for (const { roundNum, matches } of groupByRound(inGroup)) {
      out.push({ key: `g${g}-md${roundNum}`, title: `Group ${g} · Matchday ${roundNum}`, matches });
    }
  }
  return out;
}

function BracketSlot({ player, name, legs, winner, seed }: {
  player: Player | null; name: string; legs: number; winner: boolean; seed?: number;
}) {
  return (
    <div className={'bracket-slot' + (winner ? ' winner' : '') + (player ? '' : ' tbd')}>
      {seed !== undefined && <span className="bracket-seed">{seed}</span>}
      {player && <PlayerAvatar player={player} />}
      <span className="bracket-name">{name}</span>
      <span className="bracket-legs">{legs > 0 || winner ? legs : ''}</span>
    </div>
  );
}

function groupByRound(matches: TournamentMatch[]): { roundNum: number; matches: TournamentMatch[] }[] {
  const byRound = new Map<number, TournamentMatch[]>();
  for (const m of matches) {
    if (!byRound.has(m.roundNum)) byRound.set(m.roundNum, []);
    byRound.get(m.roundNum)!.push(m);
  }
  return [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([roundNum, ms]) => ({ roundNum, matches: ms.sort((a, b) => a.matchIndex - b.matchIndex) }));
}
