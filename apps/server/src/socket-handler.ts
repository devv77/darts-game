import type { Server as SocketIOServer } from 'socket.io';
import { db } from './db.js';
import { lookupSession } from './auth.js';
import { getFullGameState } from './game-state.js';
import { generateAiTurn } from './ai-engine.js';
import { parseDartScore, parseCricketDart, isValidDart, applyAtcDart, ATC_TARGET_COUNT } from './darts.js';
import { stripPiiFromGameState } from './sanitize.js';
import { isAdmin } from './auth.js';
import { settleCompletedGame, getTournamentRow, isTournamentParticipant } from './tournament-store.js';
import { sendPushToPlayer } from './push.js';
import type { FullGameState, Game, MatchSettings, Player } from './types.js';

const aiTurnInProgress = new Set<number | string>();

// Turn logger — set from index.ts (app.log) so socket turns show up in the
// container logs; a no-op by default (tests, direct handler calls).
type TurnLogger = { info: (obj: unknown, msg?: string) => void; error?: (obj: unknown, msg?: string) => void };
let log: TurnLogger = { info: () => {} };

// Socket.IO dispatches handlers outside any try/catch, so a throw from a
// malformed payload is an uncaughtException that exits the whole server.
function guarded(event: string, fn: (raw: unknown) => void): (raw: unknown) => void {
  return (raw) => {
    try {
      fn(raw);
    } catch (err) {
      log.error?.({ err, event }, 'socket-handler-error');
    }
  };
}

// Shared reference to the live io server, set by setupSocket(). Lets REST routes
// (e.g. /api/games/join) push a fresh game-state to the room without owning the
// io instance. A no-op until setupSocket runs — so .inject() tests don't need it.
let ioRef: SocketIOServer | null = null;

// Phase 8b — presence: connected-socket count per player. A player is "online"
// while they hold at least one live socket.
const onlineCounts = new Map<number, number>();
export function isPlayerOnline(playerId: number): boolean {
  return (onlineCounts.get(playerId) ?? 0) > 0;
}
export function onlinePlayerIds(): number[] {
  return [...onlineCounts.keys()];
}

/** Re-broadcast the current aggregated state to everyone in a game's room. */
export function broadcastGameState(gameId: number): void {
  if (!ioRef) return;
  const state = getFullGameState(gameId);
  ioRef.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(state));
}

/** Notify a tournament room that its state changed (e.g. a match was launched). */
export function broadcastTournamentUpdated(tournamentId: number): void {
  if (!ioRef) return;
  ioRef.to(`tournament:${tournamentId}`).emit('tournament-updated', { tournamentId });
}

/**
 * Play an all-AI game to completion synchronously (no board, no setTimeout
 * delays) — used by the tournament "Simulate" affordance (Phase 9 T4). Drives
 * the same audited handlers, so the game settles and `onGameCompleted` advances
 * the bracket exactly as a played match would. Returns false if a non-AI player
 * is on throw (can't be auto-played). Any AI turn the live scheduler manages to
 * fire afterwards no-ops (the game is already completed).
 */
export function simulateAiGame(gameId: number): boolean {
  // Fall back to a no-op emitter when no live io (e.g. tests) — the game logic
  // and tournament settle still run; only the socket broadcasts are dropped.
  const io = ioRef ?? ({ to: () => ({ emit: () => {} }) } as unknown as SocketIOServer);
  for (let guard = 0; guard < 2000; guard++) {
    const state = getFullGameState(gameId);
    if (!state || state.status !== 'in_progress') return true;
    const p = state.players[state.current_player_index];
    if (!p || !p.is_ai) return false; // a human is on throw — not simulatable
    const result = generateAiTurn(p.ai_level, state.mode, state, p.id);
    if (state.mode === 'cricket') {
      handleCricketTurn(io, gameId, p.id, result.darts, state.current_round, state);
    } else if (state.mode === 'atc') {
      handleAtcTurn(io, gameId, p.id, result.darts, state.current_round, state);
    } else {
      handleX01Turn(io, gameId, p.id, result.darts, null, state.current_round, state);
    }
  }
  return true;
}

/**
 * The single seam into the audited engine (Phase 9): after a game's winner is
 * set, settle the backing tournament match (if any) and notify the tournament
 * room. No-ops cleanly for ordinary games.
 */
function onGameCompleted(io: SocketIOServer, gameId: number): void {
  const settled = settleCompletedGame(gameId);
  if (settled) {
    io.to(`tournament:${settled.tournamentId}`).emit('tournament-updated', { tournamentId: settled.tournamentId });
  }
}

/**
 * Phase 8c — after a turn in an online game, push "your turn" to the human now
 * on throw (so they get it on the lock screen even with the tab closed). No-op
 * for offline pass-and-play, AI players, or when push isn't configured.
 */
function notifyTurnIfOnline(gameId: number): void {
  const state = getFullGameState(gameId);
  if (!state || state.status !== 'in_progress' || !state.is_online) return;
  const current = state.players[state.current_player_index];
  if (!current || current.is_ai) return;
  sendPushToPlayer(current.id, {
    title: "It's your turn 🎯",
    body: `Your throw in the ${state.mode} game.`,
    url: `/game?id=${gameId}`,
  });
}

export interface ValidatedTurn {
  gameId: number;
  playerId: number;
  darts: string[];
  scoreTotal: number | null;
  /** Quick entry only: the thrower attests the final dart was a double. */
  checkoutDouble: boolean;
}

// Double-out finishes a 3-dart visit can't reach: > 170, plus the "bogey" totals.
const IMPOSSIBLE_DOUBLE_OUT = new Set([159, 162, 163, 165, 166, 168, 169]);
export function isPossibleDoubleOut(total: number): boolean {
  return total >= 2 && total <= 170 && !IMPOSSIBLE_DOUBLE_OUT.has(total);
}

export function validateSubmitTurn(raw: unknown, sessionPlayerId: number): ValidatedTurn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const gameId = typeof r.gameId === 'number' ? r.gameId : Number(r.gameId);
  if (!Number.isInteger(gameId)) return null;
  const playerId = typeof r.playerId === 'number' ? r.playerId : Number(r.playerId);
  if (!Number.isInteger(playerId)) return null;
  if (!Array.isArray(r.darts)) return null;
  if (r.darts.length > 3) return null;
  const darts: string[] = [];
  for (const d of r.darts) {
    if (!isValidDart(d as string)) return null;
    darts.push(d as string);
  }
  // Quick (numpad) entry sends a scoreTotal with no darts. Trust it but clamp
  // to 0..180; when darts ARE present the server recomputes and ignores this.
  let scoreTotal: number | null = null;
  if (r.scoreTotal !== undefined && r.scoreTotal !== null) {
    const n = typeof r.scoreTotal === 'number' ? r.scoreTotal : Number(r.scoreTotal);
    if (!Number.isInteger(n) || n < 0 || n > 180) return null;
    scoreTotal = n;
  }
  // sessionPlayerId is intentionally not enforced equal to playerId — single
  // device pass-and-play needs the signed-in user to submit for whoever is
  // currently active. The caller still checks that BOTH ids are participants.
  void sessionPlayerId;
  const checkoutDouble = r.checkoutDouble === true;
  return { gameId, playerId, darts, scoreTotal, checkoutDouble };
}

/**
 * A client whose baked bundle version differs from this server's is running a
 * stale PWA bundle (the SW keeps it until the user accepts an update) and may
 * lack newer client-side rules — e.g. the pre-432baf4 bundle never sent
 * checkoutDouble, so its quick checkouts busted. Such clients may watch but not
 * write; they're told to reload. Unversioned (pre-check) clients are allowed.
 */
export function isOutdatedClient(clientVersion: unknown): boolean {
  const server = process.env.GIT_SHA;
  if (!server || server === 'dev') return false;
  if (typeof clientVersion !== 'string' || clientVersion === '') return false;
  if (clientVersion === 'dev') return false;
  return clientVersion !== server;
}

/** Integer id field from an untrusted socket payload (null/primitive/missing → null). */
export function payloadId(raw: unknown, key: string): number | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = (raw as Record<string, unknown>)[key];
  return Number.isInteger(v) ? (v as number) : null;
}

export function setupSocket(io: SocketIOServer, logger?: TurnLogger) {
  ioRef = io;
  if (logger) log = logger;
  io.use((socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined)
      ?? (typeof socket.handshake.headers.authorization === 'string'
        ? socket.handshake.headers.authorization.replace(/^Bearer\s+/i, '')
        : undefined);
    const player = lookupSession(token);
    if (!player) {
      next(new Error('Authentication required'));
      return;
    }
    (socket.data as { player: Player }).player = player;
    next();
  });

  io.on('connection', (socket) => {
    const connPlayer = (socket.data as { player: Player }).player;
    const outdated = isOutdatedClient(socket.handshake.auth?.version);
    const refuseIfOutdated = () => {
      if (!outdated) return false;
      socket.emit('client-outdated', { serverVersion: process.env.GIT_SHA });
      return true;
    };
    if (outdated) socket.emit('client-outdated', { serverVersion: process.env.GIT_SHA });
    if (connPlayer) onlineCounts.set(connPlayer.id, (onlineCounts.get(connPlayer.id) ?? 0) + 1);
    socket.on('disconnect', () => {
      if (!connPlayer) return;
      const n = (onlineCounts.get(connPlayer.id) ?? 1) - 1;
      if (n <= 0) onlineCounts.delete(connPlayer.id);
      else onlineCounts.set(connPlayer.id, n);
    });

    socket.on('join-game', guarded('join-game', (raw: unknown) => {
      const gameId = payloadId(raw, 'gameId');
      if (gameId === null) return;
      const sessionPlayer = (socket.data as { player: Player }).player;
      if (!sessionPlayer) return;
      const state = getFullGameState(gameId);
      if (!state) return;
      // 8d — spectator mode: any signed-in user may join read-only and receive
      // (PII-stripped) state. submit-turn / undo-turn still require participation,
      // so watchers can observe but never act.
      // One game room per socket: the client socket is a per-tab singleton, so a
      // room left over from a previously viewed game would stream that game's
      // state into this page (DR-H10).
      for (const room of socket.rooms) {
        if (room.startsWith('game:') && room !== `game:${gameId}`) socket.leave(room);
      }
      socket.join(`game:${gameId}`);
      socket.emit('game-state', stripPiiFromGameState(state));
      checkAndTriggerAiTurn(io, gameId);
    }));

    socket.on('leave-game', guarded('leave-game', (raw: unknown) => {
      const gameId = payloadId(raw, 'gameId');
      if (gameId === null) return;
      socket.leave(`game:${gameId}`);
    }));

    socket.on('submit-turn', guarded('submit-turn', (raw: unknown) => {
      if (refuseIfOutdated()) return;
      const sessionPlayer = (socket.data as { player: Player }).player;
      if (!sessionPlayer) return;
      const validated = validateSubmitTurn(raw, sessionPlayer.id);
      if (!validated) return;
      const { gameId, playerId, darts, scoreTotal, checkoutDouble } = validated;

      const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
      if (!game || game.status !== 'in_progress') return;

      const state = getFullGameState(gameId);
      if (!state) return;
      // Both the signed-in user AND the target player must be participants.
      if (!state.players.some((p) => p.id === sessionPlayer.id)) return;
      const target = state.players.find((p) => p.id === playerId);
      if (!target) return;
      // Must be the target's turn.
      if (state.players[state.current_player_index]!.id !== playerId) return;
      // Online games (Phase 8a): each device may only throw as itself, and only
      // once every seat is filled. Single-device pass-and-play (is_online === 0)
      // keeps the old behaviour where any signed-in participant can submit.
      if (game.is_online) {
        if (sessionPlayer.id !== playerId) return;
        const required = state.parsed_settings.maxPlayers ?? 2;
        if (state.players.length < required) return;
      }

      const roundNum = state.current_round;
      if (game.mode === '501' || game.mode === '301') {
        // With darts the server recomputes and ignores scoreTotal; quick
        // (numpad) entry has no darts and uses the clamped scoreTotal; it can
        // only check out a double-out leg with checkoutDouble attested.
        handleX01Turn(io, gameId, playerId, darts, scoreTotal, roundNum, state, checkoutDouble);
      } else if (game.mode === 'cricket') {
        handleCricketTurn(io, gameId, playerId, darts, roundNum, state);
      } else if (game.mode === 'atc') {
        handleAtcTurn(io, gameId, playerId, darts, roundNum, state);
      }
    }));

    // Read-only tournament room — bracket/table views live-update via
    // `tournament-updated`. Mirrors the participation guard on game rooms.
    socket.on('join-tournament', guarded('join-tournament', (raw: unknown) => {
      const tournamentId = payloadId(raw, 'tournamentId');
      if (tournamentId === null) return;
      const sessionPlayer = (socket.data as { player: Player }).player;
      if (!sessionPlayer) return;
      const t = getTournamentRow(tournamentId);
      if (!t) return;
      const allowed = isAdmin(sessionPlayer)
        || t.created_by === sessionPlayer.id
        || isTournamentParticipant(tournamentId, sessionPlayer.id);
      if (!allowed) return;
      socket.join(`tournament:${tournamentId}`);
    }));

    socket.on('leave-tournament', guarded('leave-tournament', (raw: unknown) => {
      const tournamentId = payloadId(raw, 'tournamentId');
      if (tournamentId === null) return;
      socket.leave(`tournament:${tournamentId}`);
    }));

    socket.on('undo-turn', guarded('undo-turn', (raw: unknown) => {
      if (refuseIfOutdated()) return;
      const gameId = payloadId(raw, 'gameId');
      if (gameId === null) return;
      const sessionPlayer = (socket.data as { player: Player }).player;
      if (!sessionPlayer) return;
      const pops = undoPlan(gameId, sessionPlayer);
      if (!pops) return;
      for (let i = 0; i < pops; i++) undoLastTurn(gameId);
      const newState = getFullGameState(gameId);
      io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));
      // An admin undo can hand the throw back to an AI; nothing else would wake it.
      checkAndTriggerAiTurn(io, gameId);
    }));
  });
}

/**
 * Score one X01 visit from its darts. Single-out: reaching exactly 0 wins, below
 * 0 busts. Double-out: 0 must land on a double (D1-D20 or DB), and leaving 1 or
 * going below 0 busts. The visit stops at the first dart that finishes or busts.
 */
export function scoreX01Visit(
  startScore: number,
  darts: string[],
  singleOut: boolean
): { thrown: string[]; turnScore: number; isBust: boolean } {
  let left = startScore;
  for (let i = 0; i < darts.length; i++) {
    const dart = darts[i]!;
    left -= parseDartScore(dart);
    const thrown = darts.slice(0, i + 1);
    const bust = singleOut
      ? left < 0
      : left < 0 || left === 1 || (left === 0 && !dart.startsWith('D'));
    if (bust) return { thrown, turnScore: 0, isBust: true };
    if (left === 0) return { thrown, turnScore: startScore, isBust: false };
  }
  return { thrown: darts, turnScore: startScore - left, isBust: false };
}

export function handleX01Turn(
  io: SocketIOServer,
  gameId: number,
  playerId: number,
  darts: string[],
  scoreTotal: number | null,
  roundNum: number,
  state: FullGameState,
  checkoutDouble = false
) {
  const currentScore = state.scores[playerId] ?? parseInt(state.mode, 10);
  const settings: MatchSettings = state.parsed_settings || {};
  const format = settings.format || 'single';

  // Server-authoritative score: always recompute from darts when present.
  // Empty-darts ("quick entry") trusts scoreTotal but clamps 0..180. A double-out
  // checkout without darts needs the client's checkoutDouble attestation (the
  // same trust we already give the total) and a total a double finish can reach.
  const singleOut = settings.outMode === 'single';
  let turnScore: number;
  let isBust: boolean;
  if (darts && darts.length > 0) {
    // Walk the visit dart by dart: it ends at the first dart that checks out or
    // busts, so anything entered after that (e.g. a habitual "Miss" after D20)
    // is not part of the visit and must not turn a checkout into a bust.
    const outcome = scoreX01Visit(currentScore, darts, singleOut);
    darts = outcome.thrown;
    turnScore = outcome.turnScore;
    isBust = outcome.isBust;
  } else {
    const claimed = typeof scoreTotal === 'number' && Number.isFinite(scoreTotal) ? scoreTotal : 0;
    if (claimed < 0 || claimed > 180) return; // reject obvious garbage
    turnScore = claimed;
    const left = currentScore - turnScore;
    isBust = singleOut
      ? left < 0
      // Double-out without darts: an attested, reachable double finish only.
      : (left < 0 || left === 1 || (left === 0 && !(checkoutDouble && isPossibleDoubleOut(turnScore))));
  }
  const newScore = currentScore - turnScore;

  log.info(
    { gameId, playerId, darts, scoreTotal, checkoutDouble, turnScore, currentScore, newScore, isBust },
    'x01-turn'
  );

  const currentSet = state.current_set;
  const currentLeg = state.current_leg;

  db.prepare(
    `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, is_bust, set_num, leg_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    gameId, playerId, roundNum,
    darts?.[0] || null, darts?.[1] || null, darts?.[2] || null,
    isBust ? 0 : turnScore,
    isBust ? 1 : 0,
    currentSet, currentLeg
  );

  let gameOver = false;
  let winnerId: number | null = null;

  if (!isBust && newScore === 0) {
    if (format === 'single') {
      db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(playerId, gameId);
      gameOver = true;
      winnerId = playerId;
    } else {
      const result = handleLegWin(gameId, playerId, settings);
      gameOver = result.gameOver;
      winnerId = result.winnerId;
    }
  }

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));

  if (gameOver) {
    io.to(`game:${gameId}`).emit('game-over', { gameId, winnerId });
    onGameCompleted(io, gameId);
  } else {
    checkAndTriggerAiTurn(io, gameId);
    notifyTurnIfOnline(gameId);
  }
}

function handleLegWin(gameId: number, playerId: number, settings: MatchSettings) {
  const format = settings.format || 'single';
  const bestOfLegs = settings.bestOfLegs || 1;
  const bestOfSets = settings.bestOfSets || 1;
  const bestOfLegsPerSet = settings.bestOfLegsPerSet || bestOfLegs;
  const legsToWin = format === 'sets'
    ? Math.ceil(bestOfLegsPerSet / 2)
    : Math.ceil(bestOfLegs / 2);
  const setsToWin = Math.ceil(bestOfSets / 2);

  db.prepare(
    'UPDATE game_players SET legs_won = legs_won + 1 WHERE game_id = ? AND player_id = ?'
  ).run(gameId, playerId);

  const gp = db.prepare(
    'SELECT * FROM game_players WHERE game_id = ? AND player_id = ?'
  ).get(gameId, playerId) as { legs_won: number; sets_won: number };

  let gameOver = false;
  let winnerId: number | null = null;

  if (format === 'legs') {
    if (gp.legs_won >= legsToWin) {
      db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
        .run(playerId, gameId);
      gameOver = true;
      winnerId = playerId;
    }
  } else if (format === 'sets') {
    if (gp.legs_won >= legsToWin) {
      db.prepare(
        'UPDATE game_players SET sets_won = sets_won + 1, legs_won = 0 WHERE game_id = ? AND player_id = ?'
      ).run(gameId, playerId);
      db.prepare(
        'UPDATE game_players SET legs_won = 0 WHERE game_id = ? AND player_id != ?'
      ).run(gameId, playerId);

      const updatedGp = db.prepare(
        'SELECT * FROM game_players WHERE game_id = ? AND player_id = ?'
      ).get(gameId, playerId) as { sets_won: number };

      if (updatedGp.sets_won >= setsToWin) {
        db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
          .run(playerId, gameId);
        gameOver = true;
        winnerId = playerId;
      }
    }
  }

  return { gameOver, winnerId };
}

/**
 * Around-the-Clock: clear 1→20 then the bull, in order. Single-game (no legs).
 * Advancement follows the configured rule (exact-single, or doubles/trebles
 * skip). Progress is recomputed by replaying darts (see game-state), so here we
 * only need to apply this turn's darts to detect completion and log the turn.
 */
export function handleAtcTurn(
  io: SocketIOServer,
  gameId: number,
  playerId: number,
  darts: string[],
  roundNum: number,
  state: FullGameState
) {
  const advance = state.parsed_settings?.atcAdvance === 'multiplier' ? 'multiplier' : 'single';
  const before = state.atc_state?.find((a) => a.player_id === playerId)?.hits ?? 0;
  let hits = before;
  for (const d of darts ?? []) {
    if (hits >= ATC_TARGET_COUNT) break;
    hits = applyAtcDart(hits, d, advance);
  }
  const advances = hits - before;
  const completed = hits >= ATC_TARGET_COUNT;

  log.info({ gameId, playerId, darts, before, hits, advances, completed }, 'atc-turn');

  db.prepare(
    `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, is_bust, set_num, leg_num)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    gameId, playerId, roundNum,
    darts?.[0] || null, darts?.[1] || null, darts?.[2] || null,
    advances, state.current_set, state.current_leg
  );

  let gameOver = false;
  let winnerId: number | null = null;
  if (completed) {
    db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
      .run(playerId, gameId);
    gameOver = true;
    winnerId = playerId;
  }

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));

  if (gameOver) {
    io.to(`game:${gameId}`).emit('game-over', { gameId, winnerId });
    onGameCompleted(io, gameId);
  } else {
    checkAndTriggerAiTurn(io, gameId);
    notifyTurnIfOnline(gameId);
  }
}

export function handleCricketTurn(
  io: SocketIOServer,
  gameId: number,
  playerId: number,
  darts: string[],
  roundNum: number,
  state: FullGameState
) {
  if (!darts || darts.length === 0) return;

  const playerState = state.cricket_state?.find((cs) => cs.player_id === playerId);
  if (!playerState) return;
  const opponentStates = (state.cricket_state ?? []).filter((cs) => cs.player_id !== playerId);

  let totalPoints = 0;
  const ps = { ...playerState } as Record<string, number>;

  db.transaction(() => {
    for (const dart of darts) {
      const { number, multiplier } = parseCricketDart(dart);
      if (!number) continue;

      const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
      const currentMarks = ps[col] ?? 0;
      const newMarks = currentMarks + multiplier;

      if (currentMarks >= 3) {
        const allOpponentsClosed = opponentStates.every((os) => (os as unknown as Record<string, number>)[col]! >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * multiplier;
        }
      } else if (newMarks > 3) {
        const excessMarks = newMarks - 3;
        const allOpponentsClosed = opponentStates.every((os) => (os as unknown as Record<string, number>)[col]! >= 3);
        if (!allOpponentsClosed) {
          const pointValue = number === 'bull' ? 25 : number;
          totalPoints += pointValue * excessMarks;
        }
      }

      ps[col] = newMarks;
    }

    db.prepare(
      `UPDATE cricket_state SET
       marks_15 = ?, marks_16 = ?, marks_17 = ?, marks_18 = ?,
       marks_19 = ?, marks_20 = ?, marks_bull = ?, points = points + ?
       WHERE game_id = ? AND player_id = ?`
    ).run(
      ps.marks_15, ps.marks_16, ps.marks_17,
      ps.marks_18, ps.marks_19, ps.marks_20,
      ps.marks_bull, totalPoints, gameId, playerId
    );

    const turnScore = darts.reduce((sum, d) => sum + parseDartScore(d), 0);
    db.prepare(
      `INSERT INTO turns (game_id, player_id, round_num, dart1, dart2, dart3, score_total, cricket_points)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(gameId, playerId, roundNum, darts[0] || null, darts[1] || null, darts[2] || null, turnScore, totalPoints);

    const updatedState = db.prepare('SELECT * FROM cricket_state WHERE game_id = ? AND player_id = ?')
      .get(gameId, playerId) as { marks_15: number; marks_16: number; marks_17: number; marks_18: number; marks_19: number; marks_20: number; marks_bull: number; points: number };

    const allClosed = [
      updatedState.marks_15, updatedState.marks_16, updatedState.marks_17,
      updatedState.marks_18, updatedState.marks_19, updatedState.marks_20,
      updatedState.marks_bull,
    ].every((m) => m >= 3);

    if (allClosed) {
      let canWin = true;
      if (opponentStates.length > 0) {
        const allOpponentPoints = opponentStates.map((os) => {
          const fresh = db.prepare('SELECT points FROM cricket_state WHERE game_id = ? AND player_id = ?')
            .get(gameId, os.player_id) as { points: number };
          return fresh.points;
        });
        canWin = allOpponentPoints.every((p) => updatedState.points >= p);
      }
      if (canWin) {
        db.prepare("UPDATE games SET status = 'completed', winner_id = ?, finished_at = datetime('now') WHERE id = ?")
          .run(playerId, gameId);
      }
    }
  })();

  const newState = getFullGameState(gameId);
  io.to(`game:${gameId}`).emit('game-state', stripPiiFromGameState(newState));

  if (newState?.status === 'completed') {
    io.to(`game:${gameId}`).emit('game-over', { gameId, winnerId: playerId });
    onGameCompleted(io, gameId);
  } else {
    checkAndTriggerAiTurn(io, gameId);
    notifyTurnIfOnline(gameId);
  }
}

function revertCricketTurn(
  gameId: number,
  turn: { dart1: string | null; dart2: string | null; dart3: string | null; player_id: number; cricket_points?: number }
) {
  const darts = [turn.dart1, turn.dart2, turn.dart3].filter(Boolean) as string[];
  for (const dart of darts) {
    const { number, multiplier } = parseCricketDart(dart);
    if (!number) continue;
    const col = number === 'bull' ? 'marks_bull' : `marks_${number}`;
    db.prepare(`UPDATE cricket_state SET ${col} = MAX(0, ${col} - ?) WHERE game_id = ? AND player_id = ?`)
      .run(multiplier, gameId, turn.player_id);
  }
  const pts = turn.cricket_points ?? 0;
  if (pts > 0) {
    db.prepare('UPDATE cricket_state SET points = MAX(0, points - ?) WHERE game_id = ? AND player_id = ?')
      .run(pts, gameId, turn.player_id);
  }
}

/**
 * How many turns an `undo-turn` from this player removes (0 = refused).
 *
 * - Participants (or admins) only; never a completed tournament game — its
 *   result is already settled into the bracket/table and advanced (DR-H4).
 * - Online games: a non-admin may only undo their own last visit.
 * - Offline (one shared device, pass-and-play or vs AI): any participant may
 *   undo — they can already throw for every seat. Trailing AI visits are
 *   popped together with the human visit before them, so "undo" hands the
 *   human their own visit back instead of rerolling the AI's (DR-H7).
 */
export function undoPlan(gameId: number, sessionPlayer: Player): number {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
  if (!game) return 0;
  const admin = isAdmin(sessionPlayer);
  const seats = db.prepare(
    'SELECT p.id, p.is_ai FROM game_players gp JOIN players p ON p.id = gp.player_id WHERE gp.game_id = ?'
  ).all(gameId) as { id: number; is_ai: number }[];
  if (!admin && !seats.some((p) => p.id === sessionPlayer.id)) return 0;
  if (game.status === 'completed') {
    const inTournament = db.prepare('SELECT 1 FROM tournament_matches WHERE game_id = ?').get(gameId);
    if (inTournament) return 0;
  }
  const turns = db.prepare(
    'SELECT player_id FROM turns WHERE game_id = ? ORDER BY id DESC'
  ).all(gameId) as { player_id: number }[];
  if (turns.length === 0) return 0;

  const aiIds = new Set(seats.filter((p) => p.is_ai).map((p) => p.id));
  let pops = 0;
  while (pops < turns.length && aiIds.has(turns[pops]!.player_id)) pops++;
  if (pops === turns.length) return 0; // only AI visits so far — nothing of ours to take back
  const humanTurn = turns[pops]!;
  pops++;

  if (game.is_online && !admin && humanTurn.player_id !== sessionPlayer.id) return 0;
  return pops;
}

export function undoLastTurn(gameId: number): void {
  const lastTurn = db.prepare(
    'SELECT * FROM turns WHERE game_id = ? ORDER BY id DESC LIMIT 1'
  ).get(gameId) as {
    id: number; dart1: string | null; dart2: string | null; dart3: string | null;
    player_id: number; set_num: number; leg_num: number; cricket_points: number;
  } | undefined;
  if (!lastTurn) return;

  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as Game | undefined;
  if (!game) return;

  db.transaction(() => {
    if (game.status === 'completed') {
      db.prepare("UPDATE games SET status = 'in_progress', winner_id = NULL, finished_at = NULL WHERE id = ?")
        .run(gameId);
    }
    if (game.mode === 'cricket') {
      revertCricketTurn(gameId, lastTurn);
    }
    db.prepare('DELETE FROM turns WHERE id = ?').run(lastTurn.id);
    if (game.mode === '501' || game.mode === '301') {
      rebuildLegsAndSets(gameId, game);
    }
  })();
}

function rebuildLegsAndSets(gameId: number, game: Game): void {
  const settings: MatchSettings = JSON.parse(game.settings || '{}');
  const format = settings.format || 'single';
  if (format === 'single') {
    db.prepare(
      'UPDATE game_players SET legs_won = 0, sets_won = 0 WHERE game_id = ?'
    ).run(gameId);
    return;
  }
  const players = db.prepare(
    'SELECT player_id FROM game_players WHERE game_id = ? ORDER BY position'
  ).all(gameId) as { player_id: number }[];
  const turns = db.prepare(
    'SELECT player_id, score_total, is_bust FROM turns WHERE game_id = ? ORDER BY id'
  ).all(gameId) as { player_id: number; score_total: number; is_bust: number }[];
  const startScore = parseInt(game.mode, 10);
  const legsToWin = format === 'sets'
    ? Math.ceil((settings.bestOfLegsPerSet ?? settings.bestOfLegs ?? 1) / 2)
    : Math.ceil((settings.bestOfLegs ?? 1) / 2);

  const legsWon: Record<number, number> = {};
  const setsWon: Record<number, number> = {};
  const legScores: Record<number, number> = {};
  for (const p of players) {
    legsWon[p.player_id] = 0;
    setsWon[p.player_id] = 0;
    legScores[p.player_id] = startScore;
  }
  for (const t of turns) {
    if (t.is_bust) continue;
    legScores[t.player_id] = legScores[t.player_id]! - t.score_total;
    if (legScores[t.player_id] === 0) {
      legsWon[t.player_id]!++;
      for (const p of players) legScores[p.player_id] = startScore;
      if (format === 'sets' && legsWon[t.player_id]! >= legsToWin) {
        setsWon[t.player_id]!++;
        for (const p of players) legsWon[p.player_id] = 0;
      }
    }
  }
  for (const p of players) {
    db.prepare('UPDATE game_players SET legs_won = ?, sets_won = ? WHERE game_id = ? AND player_id = ?')
      .run(legsWon[p.player_id], setsWon[p.player_id], gameId, p.player_id);
  }
}

function checkAndTriggerAiTurn(io: SocketIOServer, gameId: number) {
  if (aiTurnInProgress.has(gameId)) return;

  const state = getFullGameState(gameId);
  if (!state || state.status !== 'in_progress') return;

  const currentPlayer = state.players[state.current_player_index];
  if (!currentPlayer || !currentPlayer.is_ai) return;

  aiTurnInProgress.add(gameId);
  io.to(`game:${gameId}`).emit('ai-thinking', { gameId, playerId: currentPlayer.id });

  const delay = 1000 + Math.random() * 2000;

  setTimeout(() => {
    aiTurnInProgress.delete(gameId);

    const freshState = getFullGameState(gameId);
    if (!freshState || freshState.status !== 'in_progress') return;

    const aiPlayer = freshState.players[freshState.current_player_index];
    if (!aiPlayer || !aiPlayer.is_ai || aiPlayer.id !== currentPlayer.id) return;

    const result = generateAiTurn(aiPlayer.ai_level, freshState.mode, freshState, aiPlayer.id);
    const roundNum = freshState.current_round;

    if (freshState.mode === '501' || freshState.mode === '301') {
      handleX01Turn(io, gameId, aiPlayer.id, result.darts, null, roundNum, freshState);
    } else if (freshState.mode === 'cricket') {
      handleCricketTurn(io, gameId, aiPlayer.id, result.darts, roundNum, freshState);
    } else if (freshState.mode === 'atc') {
      handleAtcTurn(io, gameId, aiPlayer.id, result.darts, roundNum, freshState);
    }
  }, delay);
}
