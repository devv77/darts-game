import { useEffect, useRef, useState } from 'react';
import { getSocket } from '../lib/socket';
import { triggerThrowAnimation } from '../lib/animations';
import type { FullGameState } from '../types';

export interface UseGameResult {
  state: FullGameState | null;
  aiThinking: boolean;
  submitTurn: (playerId: number, darts: string[], scoreTotal?: number) => void;
  undoTurn: () => void;
  gameOverEventCount: number;
}

export function useGame(gameId: number | null): UseGameResult {
  const [state, setState] = useState<FullGameState | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [gameOverEventCount, setGameOverEventCount] = useState(0);
  const prevTurnCountRef = useRef(0);
  // Guards against double-submit (rapid double-tap / Enter-repeat): a second
  // submit is ignored until the resulting game-state arrives. The server already
  // rejects an out-of-turn resubmit in 2+ player games, but a solo game (1-player
  // cricket) would otherwise double-count, and it's wasteful everywhere.
  const submitLockRef = useRef(false);

  useEffect(() => {
    if (gameId == null) return;
    submitLockRef.current = false;
    const socket = getSocket();
    socket.emit('join-game', { gameId });

    const onConnect = () => socket.emit('join-game', { gameId });
    const onGameState = (s: FullGameState) => {
      // Trigger animations on new turns
      if (s.turns.length > prevTurnCountRef.current && prevTurnCountRef.current > 0) {
        const lastTurn = s.turns[s.turns.length - 1]!;
        if (s.status === 'completed' && s.winner_id) {
          triggerThrowAnimation(lastTurn.score_total, true);
        } else if (lastTurn.is_bust) {
          triggerThrowAnimation(-1, false);
        } else {
          triggerThrowAnimation(lastTurn.score_total, false);
        }
      }
      prevTurnCountRef.current = s.turns.length;
      submitLockRef.current = false;
      setState(s);
      setAiThinking(false);
    };
    const onGameOver = () => setGameOverEventCount((c) => c + 1);
    const onAiThinking = () => setAiThinking(true);

    socket.on('connect', onConnect);
    socket.on('game-state', onGameState);
    socket.on('game-over', onGameOver);
    socket.on('ai-thinking', onAiThinking);

    return () => {
      socket.off('connect', onConnect);
      socket.off('game-state', onGameState);
      socket.off('game-over', onGameOver);
      socket.off('ai-thinking', onAiThinking);
    };
  }, [gameId]);

  function submitTurn(playerId: number, darts: string[], scoreTotal?: number) {
    if (gameId == null || submitLockRef.current) return;
    submitLockRef.current = true;
    getSocket().emit('submit-turn', { gameId, playerId, darts, scoreTotal });
    // Safety release: if the turn is rejected server-side no game-state follows,
    // so don't wedge the input forever.
    window.setTimeout(() => { submitLockRef.current = false; }, 3000);
  }

  function undoTurn() {
    if (gameId == null || submitLockRef.current) return;
    submitLockRef.current = true;
    getSocket().emit('undo-turn', { gameId });
    window.setTimeout(() => { submitLockRef.current = false; }, 3000);
  }

  return { state, aiThinking, submitTurn, undoTurn, gameOverEventCount };
}
