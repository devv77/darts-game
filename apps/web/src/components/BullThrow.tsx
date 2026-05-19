import { useEffect, useMemo, useRef, useState } from 'react';
import { gsap } from 'gsap';
import type { Player } from '../types';
import {
  simulateAiDistance,
  simulateHumanDistance,
  sortByDistance,
  type BullThrowResult,
} from '../lib/bull-throw';
import { PlayerAvatar } from './PlayerAvatar';

interface Props {
  players: Player[];
  onComplete: (sortedPlayerIds: number[]) => void;
  onSkip: () => void;
}

interface Landed extends BullThrowResult {
  angleDeg: number;
}

// WHY: SVG board is 220x220 viewBox-units centered on (110,110). 50mm IRL
// (the worst AI mean) maps roughly to the outer scoring ring — keep the
// linear scale so the visual distance matches the model.
const BOARD_SIZE = 220;
const BOARD_CENTER = BOARD_SIZE / 2;
const MAX_RENDER_MM = 80;
const RENDER_RADIUS = BOARD_SIZE * 0.45;

function mmToRadius(mm: number): number {
  const clamped = Math.min(mm, MAX_RENDER_MM);
  return (clamped / MAX_RENDER_MM) * RENDER_RADIUS;
}

export function BullThrow({ players, onComplete, onSkip }: Props) {
  const [currentIdx, setCurrentIdx] = useState(0);
  const [landed, setLanded] = useState<Landed[]>([]);
  const [phase, setPhase] = useState<'waiting' | 'throwing' | 'done'>('waiting');
  const [winnerId, setWinnerId] = useState<number | null>(null);
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentPlayer = players[currentIdx];
  const isAiTurn = currentPlayer?.is_ai === 1;

  const sortedResults = useMemo(
    () => (phase === 'done' ? sortByDistance(landed) : []),
    [phase, landed]
  );

  function throwDart() {
    if (!currentPlayer || phase === 'throwing') return;
    setPhase('throwing');
    const distanceMm = isAiTurn
      ? simulateAiDistance(currentPlayer.ai_level ?? 5)
      : simulateHumanDistance();
    const angleDeg = Math.random() * 360;
    const newLanded: Landed = {
      playerId: currentPlayer.id,
      distanceMm,
      angleDeg,
    };
    setLanded((prev) => [...prev, newLanded]);

    setTimeout(() => {
      if (currentIdx + 1 >= players.length) {
        const sorted = sortByDistance([...landed, newLanded]);
        setWinnerId(sorted[0]?.playerId ?? null);
        setPhase('done');
      } else {
        setCurrentIdx((i) => i + 1);
        setPhase('waiting');
      }
    }, 700);
  }

  useEffect(() => {
    if (phase !== 'waiting') return;
    if (!isAiTurn) return;
    aiTimerRef.current = setTimeout(() => {
      throwDart();
    }, 800);
    return () => {
      if (aiTimerRef.current) clearTimeout(aiTimerRef.current);
    };
  }, [phase, currentIdx, isAiTurn]);

  useEffect(() => {
    if (phase !== 'done' || winnerId == null) return;
    const el = document.querySelector(`[data-bull-dart="${winnerId}"]`);
    if (el) {
      gsap.fromTo(
        el,
        { scale: 1 },
        { scale: 1.6, repeat: 1, yoyo: true, duration: 0.45, ease: 'power2.inOut' }
      );
    }
    const timer = setTimeout(() => {
      onComplete(sortedResults.map((r) => r.playerId));
    }, 2200);
    return () => clearTimeout(timer);
  }, [phase, winnerId, sortedResults, onComplete]);

  return (
    <div className="bull-throw-overlay" role="dialog" aria-label="Bull throw">
      <div className="bull-throw-card">
        <div className="bull-throw-header">
          <h2>Bull Throw</h2>
          <p className="bull-throw-sub">
            {phase === 'done'
              ? 'Closest to bull throws first.'
              : 'One dart each — closest to bull wins first throw.'}
          </p>
        </div>

        <div className="bull-throw-board-wrap">
          <svg
            className="bull-throw-board"
            viewBox={`0 0 ${BOARD_SIZE} ${BOARD_SIZE}`}
            role="img"
            aria-label="Dartboard"
          >
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={BOARD_CENTER - 2} fill="#1a1f2e" stroke="#0a0e18" strokeWidth="2" />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={RENDER_RADIUS} fill="none" stroke="#2a3247" strokeWidth="1" />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={RENDER_RADIUS * 0.65} fill="none" stroke="#2a3247" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={14} fill="#22c55e" stroke="#0a0e18" strokeWidth="1" />
            <circle cx={BOARD_CENTER} cy={BOARD_CENTER} r={6} fill="#e53935" stroke="#0a0e18" strokeWidth="1" />

            {landed.map((dart, i) => {
              const r = mmToRadius(dart.distanceMm);
              const rad = (dart.angleDeg * Math.PI) / 180;
              const x = BOARD_CENTER + Math.cos(rad) * r;
              const y = BOARD_CENTER + Math.sin(rad) * r;
              const player = players.find((p) => p.id === dart.playerId);
              const isWinner = phase === 'done' && winnerId === dart.playerId;
              return (
                <g key={`${dart.playerId}-${i}`} data-bull-dart={dart.playerId}>
                  {isWinner && (
                    <circle cx={x} cy={y} r={11} fill="rgba(251,191,36,0.35)" />
                  )}
                  <circle
                    cx={x}
                    cy={y}
                    r={5}
                    fill={player?.avatar_color ?? '#fff'}
                    stroke={isWinner ? '#fbbf24' : '#0a0e18'}
                    strokeWidth={isWinner ? 2 : 1.5}
                  />
                </g>
              );
            })}
          </svg>
        </div>

        <div className="bull-throw-roster">
          {players.map((p, i) => {
            const dart = landed.find((d) => d.playerId === p.id);
            const isCurrent = i === currentIdx && phase !== 'done';
            const isWinner = phase === 'done' && p.id === winnerId;
            return (
              <div
                key={p.id}
                className={
                  'bull-throw-player' +
                  (isCurrent ? ' is-current' : '') +
                  (isWinner ? ' is-winner' : '')
                }
              >
                <PlayerAvatar player={p} />
                <span className="bull-throw-name">{p.name}</span>
                {dart ? (
                  <span className="bull-throw-dist">{dart.distanceMm.toFixed(1)} mm</span>
                ) : (
                  <span className="bull-throw-dist bull-throw-dist--pending">—</span>
                )}
              </div>
            );
          })}
        </div>

        {phase === 'done' && winnerId != null ? (
          <div className="bull-throw-result">
            <strong>{players.find((p) => p.id === winnerId)?.name}</strong> throws first.
          </div>
        ) : isAiTurn ? (
          <div className="bull-throw-action">
            <span className="bull-throw-thinking">
              {currentPlayer?.name} is throwing…
            </span>
          </div>
        ) : (
          <div className="bull-throw-action">
            <button
              type="button"
              className="bull-throw-btn"
              onClick={throwDart}
              disabled={phase === 'throwing' || !currentPlayer}
            >
              {currentPlayer ? `${currentPlayer.name} — Throw` : 'Throw'}
            </button>
          </div>
        )}

        <button type="button" className="bull-throw-skip" onClick={onSkip}>
          Skip bull throw
        </button>
      </div>
    </div>
  );
}
