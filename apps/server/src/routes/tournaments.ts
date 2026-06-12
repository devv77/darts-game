import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import { broadcastTournamentUpdated } from '../socket-handler.js';
import {
  createTournament, getTournamentRow, getTournamentState, listTournaments,
  launchMatch, deleteTournament, isTournamentParticipant,
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
}

const FORMATS: TournamentFormat[] = ['knockout', 'league', 'groups_knockout'];
const MODES: GameMode[] = ['501', '301', 'cricket'];

export async function tournamentsRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateBody }>('/api/tournaments', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const { name, format, mode, matchSettings, options, playerIds } = req.body || {};

    const trimmedName = (name || '').trim();
    if (!trimmedName) return reply.code(400).send({ error: 'Tournament name required' });
    if (trimmedName.length > 80) return reply.code(400).send({ error: 'Tournament name too long' });
    if (!format || !FORMATS.includes(format)) return reply.code(400).send({ error: 'Invalid format' });
    if (!mode || !MODES.includes(mode)) return reply.code(400).send({ error: 'Invalid mode' });
    if (format !== 'knockout') {
      return reply.code(400).send({ error: 'Only knockout tournaments are available right now' });
    }
    if (!Array.isArray(playerIds) || playerIds.length < 2) {
      return reply.code(400).send({ error: 'At least 2 players required' });
    }
    if (playerIds.length > 32) {
      return reply.code(400).send({ error: 'A tournament can have at most 32 players' });
    }
    if (!playerIds.every((id) => Number.isInteger(id))) {
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
      return reply.code(400).send({ error: `Unknown player ids: ${playerIds.filter((id) => !known.has(id)).join(', ')}` });
    }

    let id: number;
    try {
      id = createTournament({
        name: trimmedName, format, mode,
        matchSettings: matchSettings || {}, options: options || {},
        playerIds, isOnline: false, createdBy: viewer.id,
      });
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
    return reply.code(201).send(getTournamentState(id, viewer));
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
      // Single-device (T1): admin or creator launches. (Per-participant gating is T5.)
      if (!isAdmin(viewer) && t.created_by !== viewer.id) {
        return reply.code(403).send({ error: 'Only the organiser can launch matches' });
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
