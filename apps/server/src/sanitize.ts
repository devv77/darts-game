import { isAdmin } from './auth.js';
import type { FullGameState, GamePlayer, Player } from './types.js';

/**
 * Strip personally-identifying fields (email, google_id) from a Player row
 * when the viewer is not the player themselves and not an admin. AI players
 * never carry PII so they pass through unchanged.
 */
export function sanitizePlayer(target: Player, viewer: Player | null | undefined): Player {
  if (target.is_ai) return target;
  if (viewer && (viewer.id === target.id || isAdmin(viewer))) return target;
  return {
    ...target,
    email: null,
    google_id: null,
  };
}

/** Same as sanitizePlayer but preserves the GamePlayer-specific fields. */
export function sanitizeGamePlayer(target: GamePlayer, viewer: Player | null | undefined): GamePlayer {
  if (target.is_ai) return target;
  if (viewer && (viewer.id === target.id || isAdmin(viewer))) return target;
  return {
    ...target,
    email: null,
    google_id: null,
  };
}

/**
 * Strip email + google_id from every player in a FullGameState payload.
 * Used for socket broadcasts that fan out to multiple participants — the UI
 * doesn't need PII for gameplay, and each socket recipient would otherwise
 * see counterparts' emails.
 */
export function stripPiiFromGameState(state: FullGameState | null): FullGameState | null {
  if (!state) return state;
  return {
    ...state,
    players: state.players.map((p) =>
      p.is_ai ? p : { ...p, email: null, google_id: null }
    ),
  };
}
