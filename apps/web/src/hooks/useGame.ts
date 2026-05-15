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

  useEffect(() => {
    if (gameId == null) return;
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
    if (gameId == null) return;
    getSocket().emit('submit-turn', { gameId, playerId, darts, scoreTotal });
  }

  function undoTurn() {
    if (gameId == null) return;
    getSocket().emit('undo-turn', { gameId });
  }

  return { state, aiThinking, submitTurn, undoTurn, gameOverEventCount };
}
