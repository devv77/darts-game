import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { initVoice, isVoiceEnabled, setVoiceEnabled } from '../lib/animations';
import { useGame } from '../hooks/useGame';
import { Scoreboard } from '../components/Scoreboard';
import { ThrowHistory } from '../components/ThrowHistory';
import { SuggestionStrip } from '../components/SuggestionStrip';
import { X01Input } from '../components/X01Input';
import { CricketInput } from '../components/CricketInput';
import { CricketGrid } from '../components/CricketGrid';
import { PostMatchReview } from '../components/PostMatchReview';
import { getSuggestion } from '../lib/suggestions';
import type { PlayerStats } from '../types';

export function GamePage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const gameId = useMemo(() => {
    const v = params.get('id');
    return v ? parseInt(v, 10) : null;
  }, [params]);

  const { state, aiThinking, submitTurn, undoTurn, gameOverEventCount } = useGame(gameId);
  const [statsCache, setStatsCache] = useState<Record<number, PlayerStats>>({});
  const [statsFetched, setStatsFetched] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [showReview, setShowReview] = useState(false);

  useEffect(() => {
    initVoice();
    setVoiceOn(isVoiceEnabled());
  }, []);

  // Apply game-page body class for full-viewport layout
  useEffect(() => {
    document.body.classList.add('game-page');
    return () => document.body.classList.remove('game-page');
  }, []);

  // Wake lock
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        if ('wakeLock' in navigator) {
          lock = await (navigator.wakeLock as { request: (t: 'screen') => Promise<WakeLockSentinel> }).request('screen');
        }
      } catch { /* denied */ }
    };
    void acquire();
    const onVis = () => { if (document.visibilityState === 'visible' && !cancelled) void acquire(); };
    document.addEventListener('visibilitychange', onVis);
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) window.location.reload(); };
    window.addEventListener('pageshow', onShow);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onShow);
      lock?.release().catch(() => {});
    };
  }, []);

  // Fetch player stats once for suggestions
  useEffect(() => {
    if (!state || statsFetched) return;
    if (state.mode === '501' || state.mode === '301') {
      setStatsFetched(true);
      state.players.filter((p) => !p.is_ai).forEach((p) => {
        api.get<PlayerStats>(`/api/stats/players/${p.id}`)
          .then((s) => setStatsCache((prev) => ({ ...prev, [p.id]: s })))
          .catch(() => {});
      });
    }
  }, [state, statsFetched]);

  // Set CSS variable for active player color
  useEffect(() => {
    if (state && state.status === 'in_progress') {
      const current = state.players[state.current_player_index];
      if (current) document.documentElement.style.setProperty('--player-color', current.avatar_color);
    }
  }, [state]);

  // Show review when game-over event fires
  useEffect(() => {
    if (gameOverEventCount > 0 && state?.status === 'completed') {
      setShowReview(true);
    }
  }, [gameOverEventCount, state?.status]);

  // Also show review if landing on a completed game
  useEffect(() => {
    if (state?.status === 'completed' && state.winner_id && !showReview) {
      setShowReview(true);
    }
  }, [state?.status, state?.winner_id, showReview]);

  if (!gameId) {
    navigate('/');
    return null;
  }
  if (!state) {
    return (
      <>
        <header className="game-header">
          <a href="/" className="game-back">◀ Lobby</a>
          <div className="game-title">
            <span className="game-mode-badge">Loading…</span>
          </div>
        </header>
      </>
    );
  }

  const currentPlayer = state.players[state.current_player_index];
  const isAiTurn = !!(currentPlayer?.is_ai && state.status === 'in_progress');
  const isX01 = state.mode === '501' || state.mode === '301';

  let modeLabel: string = state.mode;
  const settings = state.parsed_settings || {};
  if (settings.format === 'legs') modeLabel += ` Bo${settings.bestOfLegs}`;
  else if (settings.format === 'sets') modeLabel += ` Bo${settings.bestOfSets}S`;

  let suggestion = null;
  if (isX01 && currentPlayer && !currentPlayer.is_ai && state.status === 'in_progress') {
    const score = state.scores[currentPlayer.id]!;
    const stats = statsCache[currentPlayer.id] || null;
    const playerTurns = state.turns.filter((t) => t.player_id === currentPlayer.id);
    const lastTurn = playerTurns.length > 0 ? playerTurns[playerTurns.length - 1] : null;
    const turnsThisLeg = state.turns.filter(
      (t) => t.player_id === currentPlayer.id && t.set_num === state.current_set && t.leg_num === state.current_leg
    ).length;
    suggestion = getSuggestion(score, stats, {
      round: state.current_round,
      lastTurnBusted: lastTurn ? !!lastTurn.is_bust : false,
      turnsThisLeg,
    });
  }

  function toggleVoice() {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
  }

  function handleX01Quick(score: number) {
    if (!currentPlayer) return;
    submitTurn(currentPlayer.id, [], score);
  }
  function handleX01Darts(darts: string[]) {
    if (!currentPlayer) return;
    submitTurn(currentPlayer.id, darts);
  }
  function handleCricket(darts: string[]) {
    if (!currentPlayer) return;
    submitTurn(currentPlayer.id, darts);
  }

  return (
    <>
      <header className="game-header">
        <a href="/" className="game-back">◀ Lobby</a>
        <div className="game-title">
          <span className="game-mode-badge">{modeLabel}</span>
          <span className="round-badge">R{state.current_round}</span>
          <button className="voice-toggle" title="Toggle voice caller" onClick={toggleVoice}>
            {voiceOn ? '🔊' : '🔇'}
          </button>
        </div>
      </header>

      <main className="game-main">
        <Scoreboard state={state} />

        {isX01 && <ThrowHistory state={state} />}

        {suggestion && <SuggestionStrip suggestion={suggestion} />}

        {!isX01 && <CricketGrid state={state} />}

        {aiThinking && (
          <div className="ai-thinking">
            <span className="ai-dot" />
            <span>AI is throwing...</span>
          </div>
        )}

        {!isAiTurn && state.status === 'in_progress' && currentPlayer && (
          <div className="input-area">
            {isX01 ? (
              <X01Input
                remainingScore={state.scores[currentPlayer.id]!}
                currentPlayerName={currentPlayer.name}
                stats={statsCache[currentPlayer.id] || null}
                onSubmitQuickScore={handleX01Quick}
                onSubmitDarts={handleX01Darts}
              />
            ) : (
              <CricketInput
                currentPlayerName={currentPlayer.name}
                onConfirm={handleCricket}
              />
            )}
          </div>
        )}

        <div className="game-actions">
          <button className="undo-btn" onClick={undoTurn}>Undo</button>
        </div>
      </main>

      {showReview && state.status === 'completed' && state.winner_id && (
        <PostMatchReview
          state={state}
          winnerId={state.winner_id}
          onClose={() => setShowReview(false)}
        />
      )}
    </>
  );
}
