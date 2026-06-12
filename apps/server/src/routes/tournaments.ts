import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import { broadcastTournamentUpdated } from '../socket-handler.js';
import {
  createTournament, getTournamentRow, getTournamentState, listTournaments,
  launchMatch, deleteTournament, isTournamentParticipant, isMatchParticipant,
  joinTournamentByCode, startTournament,
} from '../tournament-store.js';
import type { GameMode, MatchSettings, TournamentFormat, TournamentOptions } from '../types.js';

interface CreateBody {
  name?: string;
  format?: TournamentFormat;
  mode?: GameMode;
  matchSettings?: MatchSettings;
  options?: TournamentOptions;
  playerIds?: number[];
  isOnline?: boolean;
  targetSize?: number;
}

const FORMATS: TournamentFormat[] = ['knockout', 'league', 'groups_knockout'];
const MODES: GameMode[] = ['501', '301', 'cricket'];

export async function tournamentsRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateBody }>('/api/tournaments', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const { name, format, mode, matchSettings, options, playerIds, isOnline, targetSize } = req.body || {};

    const trimmedName = (name || '').trim();
    if (!trimmedName) return reply.code(400).send({ error: 'Tournament name required' });
    if (trimmedName.length > 80) return reply.code(400).send({ error: 'Tournament name too long' });
    if (!format || !FORMATS.includes(format)) return reply.code(400).send({ error: 'Invalid format' });
    if (!mode || !MODES.includes(mode)) return reply.code(400).send({ error: 'Invalid mode' });
    if (format === 'groups_knockout') {
      const gc = Number((options as { groupCount?: unknown })?.groupCount);
      const adv = Number((options as { advancePerGroup?: unknown })?.advancePerGroup);
      if (!Number.isInteger(gc) || gc < 2 || gc > 8) {
        return reply.code(400).send({ error: 'groupCount must be 2–8' });
      }
      if (!Number.isInteger(adv) || adv < 1 || adv > 4) {
        return reply.code(400).send({ error: 'advancePerGroup must be 1–4' });
      }
    }

    let id: number;
    try {
      if (isOnline === true) {
        // The host opens a lobby with `targetSize` seats; entrants join by code.
        const target = Number(targetSize);
        if (!Number.isInteger(target) || target < 2 || target > 32) {
          return reply.code(400).send({ error: 'Online tournaments need a player count of 2–32' });
        }
        id = createTournament({
          name: trimmedName, format, mode,
          matchSettings: matchSettings || {}, options: options || {},
          playerIds: [viewer.id], isOnline: true, targetSize: target, createdBy: viewer.id,
        });
      } else {
        if (!Array.isArray(playerIds) || playerIds.length < 2) {
          return reply.code(400).send({ error: 'At least 2 players required' });
        }
        if (playerIds.length > 32) {
          return reply.code(400).send({ error: 'A tournament can have at most 32 players' });
        }
        if (!playerIds.every((pid) => Number.isInteger(pid))) {
          return reply.code(400).send({ error: 'playerIds must be integers' });
        }
        if (new Set(playerIds).size !== playerIds.length) {
          return reply.code(400).send({ error: 'Duplicate playerIds' });
        }
        if (!isAdmin(viewer) && !playerIds.includes(viewer.id)) {
          return reply.code(403).send({ error: 'You must be a participant in tournaments you create' });
        }
        const found = db.prepare(
          `SELECT id FROM players WHERE id IN (${playerIds.map(() => '?').join(',')})`
        ).all(...playerIds) as { id: number }[];
        if (found.length !== playerIds.length) {
          const known = new Set(found.map((r) => r.id));
          return reply.code(400).send({ error: `Unknown player ids: ${playerIds.filter((pid) => !known.has(pid)).join(', ')}` });
        }
        id = createTournament({
          name: trimmedName, format, mode,
          matchSettings: matchSettings || {}, options: options || {},
          playerIds, isOnline: false, createdBy: viewer.id,
        });
      }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return reply.code(201).send(getTournamentState(id, viewer));
  });

  app.post<{ Body: { code?: string } }>('/api/tournaments/join', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const code = String(req.body?.code ?? '').trim().toUpperCase();
    if (!code) return reply.code(400).send({ error: 'Invite code required' });
    let tid: number;
    try {
      tid = joinTournamentByCode(code, viewer.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 400;
      return reply.code(status).send({ error: (err as Error).message });
    }
    broadcastTournamentUpdated(tid);
    return getTournamentState(tid, viewer);
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const t = getTournamentRow(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Tournament not found' });
    if (!isAdmin(viewer) && t.created_by !== viewer.id) {
      return reply.code(403).send({ error: 'Only the organiser can start the tournament' });
    }
    try {
      startTournament(t.id);
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode || 400;
      return reply.code(status).send({ error: (err as Error).message });
    }
    broadcastTournamentUpdated(t.id);
    return getTournamentState(t.id, viewer);
  });

  app.get<{ Querystring: { status?: string } }>('/api/tournaments', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    return listTournaments(viewer, isAdmin(viewer), req.query.status);
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const t = getTournamentRow(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Tournament not found' });
    if (!isAdmin(viewer) && t.created_by !== viewer.id && !isTournamentParticipant(t.id, viewer.id)) {
      return reply.code(403).send({ error: 'Not a participant in this tournament' });
    }
    return getTournamentState(t.id, viewer);
  });

  app.post<{ Params: { id: string; mid: string } }>(
    '/api/tournaments/:id/matches/:mid/launch',
    async (req, reply) => {
      const viewer = req.player;
      if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
      const tid = parseInt(req.params.id, 10);
      const mid = parseInt(req.params.mid, 10);
      if (!Number.isInteger(tid) || !Number.isInteger(mid)) {
        return reply.code(400).send({ error: 'Invalid ids' });
      }
      const t = getTournamentRow(tid);
      if (!t) return reply.code(404).send({ error: 'Tournament not found' });
      // Single-device: admin/creator launches. Online: either of the match's two
      // participants can open their own tie (each then plays on their own device).
      const allowed = isAdmin(viewer) || t.created_by === viewer.id
        || (t.is_online === 1 && isMatchParticipant(tid, mid, viewer.id));
      if (!allowed) {
        return reply.code(403).send({ error: 'Not allowed to launch this match' });
      }
      let gameId: number;
      try {
        gameId = launchMatch(tid, mid);
      } catch (err) {
        const code = (err as { statusCode?: number }).statusCode || 400;
        return reply.code(code).send({ error: (err as Error).message });
      }
      broadcastTournamentUpdated(tid);
      return { gameId };
    }
  );

  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const t = getTournamentRow(req.params.id);
    if (!t) return reply.code(404).send({ error: 'Tournament not found' });
    if (!isAdmin(viewer) && t.created_by !== viewer.id) {
      return reply.code(403).send({ error: 'Only the organiser can delete a tournament' });
    }
    deleteTournament(t.id);
    return reply.code(204).send();
  });
}
