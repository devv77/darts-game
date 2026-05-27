import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { isAdmin } from '../auth.js';
import {
  generateTargets,
  applyTurn,
  computeMetrics,
  summaryMetricsForHistory,
  isValidDart,
  type PracticeTarget,
  type PracticeResult,
  type PracticeMetrics,
} from '../practice-engine.js';
import type {
  DrillType,
  Difficulty,
  Player,
  PracticeSessionRow,
  PracticeHistoryRow,
} from '../types.js';

const DRILL_TYPES: DrillType[] = ['checkout', 'scoring', 'around_the_clock', 'doubles'];
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];

interface CreatePracticeBody {
  playerId?: number;
  drillType?: DrillType;
  difficulty?: Difficulty;
}

interface TurnBody {
  darts?: string[];
  scoreTotal?: number;
}

interface PracticeState {
  id: number;
  playerId: number;
  drillType: DrillType;
  difficulty: Difficulty | null;
  targets: PracticeTarget[];
  results: PracticeResult[];
  currentIndex: number;
  currentTargetDarts: number;
  finished: boolean;
  startedAt: string;
  finishedAt: string | null;
  metrics: PracticeMetrics;
}

function lifetimeAvg(playerId: number): number | undefined {
  const row = db.prepare(
    `SELECT t.score_total, t.dart1, t.dart2, t.dart3 FROM turns t
     JOIN games g ON g.id = t.game_id
     WHERE t.player_id = ? AND g.mode IN ('501', '301') AND t.is_bust = 0`
  ).all(playerId) as { score_total: number; dart1: string | null; dart2: string | null; dart3: string | null }[];
  if (row.length === 0) return undefined;
  let totalScore = 0;
  let totalDarts = 0;
  for (const t of row) {
    totalScore += t.score_total;
    const d = [t.dart1, t.dart2, t.dart3].filter(Boolean).length;
    totalDarts += d > 0 ? d : 3;
  }
  if (totalDarts === 0) return undefined;
  return (totalScore / totalDarts) * 3;
}

function toState(row: PracticeSessionRow): PracticeState {
  const metrics = computeMetrics(row);
  if (row.drill_type === 'scoring') {
    const avg = lifetimeAvg(row.player_id);
    if (avg !== undefined) metrics.lifetimeAvg = avg;
  }
  return {
    id: row.id,
    playerId: row.player_id,
    drillType: row.drill_type,
    difficulty: row.difficulty,
    targets: JSON.parse(row.targets_json) as PracticeTarget[],
    results: JSON.parse(row.results_json) as PracticeResult[],
    currentIndex: row.current_index,
    currentTargetDarts: row.current_target_darts,
    finished: row.finished_at !== null,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    metrics,
  };
}

function getSession(id: number): PracticeSessionRow | undefined {
  return db.prepare('SELECT * FROM practice_sessions WHERE id = ?').get(id) as PracticeSessionRow | undefined;
}

function canAccess(viewer: Player | undefined, ownerId: number): boolean {
  return !!viewer && (viewer.id === ownerId || isAdmin(viewer));
}

export async function practiceRoutes(app: FastifyInstance) {
  app.post<{ Body: CreatePracticeBody }>('/api/practice', async (req, reply) => {
    const viewer = req.player;
    if (!viewer) return reply.code(401).send({ error: 'Authentication required' });
    const { playerId, drillType, difficulty } = req.body || {};
    if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'playerId required' });
    if (!drillType || !DRILL_TYPES.includes(drillType)) {
      return reply.code(400).send({ error: 'Invalid drillType' });
    }
    if (difficulty !== undefined && !DIFFICULTIES.includes(difficulty)) {
      return reply.code(400).send({ error: 'Invalid difficulty' });
    }
    if (!canAccess(viewer, playerId!)) {
      return reply.code(403).send({ error: 'Cannot create a practice session for another player' });
    }
    const exists = db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId);
    if (!exists) return reply.code(400).send({ error: 'Unknown player' });

    const diff = drillType === 'checkout' ? (difficulty ?? null) : null;
    const targets = generateTargets(drillType, diff ?? undefined);
    const result = db.prepare(
      `INSERT INTO practice_sessions (player_id, drill_type, difficulty, targets_json)
       VALUES (?, ?, ?, ?)`
    ).run(playerId, drillType, diff, JSON.stringify(targets));
    const row = getSession(result.lastInsertRowid as number)!;
    return reply.code(201).send(toState(row));
  });

  app.get<{ Params: { id: string } }>('/api/practice/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });
    const row = getSession(id);
    if (!row) return reply.code(404).send({ error: 'Practice session not found' });
    if (!canAccess(req.player, row.player_id)) {
      return reply.code(403).send({ error: 'Not your practice session' });
    }
    return toState(row);
  });

  app.post<{ Params: { id: string }; Body: TurnBody }>('/api/practice/:id/turn', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'Invalid id' });
    const row = getSession(id);
    if (!row) return reply.code(404).send({ error: 'Practice session not found' });
    if (!canAccess(req.player, row.player_id)) {
      return reply.code(403).send({ error: 'Not your practice session' });
    }
    if (row.finished_at !== null) {
      return reply.code(409).send({ error: 'Practice session already finished' });
    }

    const { darts, scoreTotal } = req.body || {};
    if (row.drill_type === 'scoring') {
      if (!Number.isInteger(scoreTotal) || scoreTotal! < 0 || scoreTotal! > 180) {
        return reply.code(400).send({ error: 'scoreTotal must be an integer 0..180' });
      }
    } else {
      if (!Array.isArray(darts) || darts.length === 0 || darts.length > 3) {
        return reply.code(400).send({ error: 'darts must be an array of 1..3 dart strings' });
      }
      if (!darts.every((d) => typeof d === 'string' && isValidDart(d))) {
        return reply.code(400).send({ error: 'Invalid dart notation' });
      }
    }

    const outcome = applyTurn(row, { darts, scoreTotal });
    const nowFinished = outcome.finished;

    const persisted = db.transaction(() => {
      const results = JSON.parse(row.results_json) as PracticeResult[];
      results.push(...outcome.resultsToAppend);
      db.prepare(
        `UPDATE practice_sessions
         SET results_json = ?, current_index = ?, current_target_darts = ?,
             total_successes = ?, scoring_total = ?, darts_thrown = ?,
             finished_at = CASE WHEN ? = 1 THEN datetime('now') ELSE finished_at END
         WHERE id = ?`
      ).run(
        JSON.stringify(results),
        outcome.currentIndex,
        outcome.currentTargetDarts,
        outcome.totalSuccesses,
        outcome.scoringTotal,
        outcome.dartsThrown,
        nowFinished ? 1 : 0,
        id,
      );
      const updated = getSession(id)!;
      if (nowFinished) {
        const insertHistory = db.prepare(
          `INSERT INTO practice_history (player_id, drill_type, difficulty, metric_name, metric_value)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const s of summaryMetricsForHistory(updated)) {
          insertHistory.run(updated.player_id, updated.drill_type, updated.difficulty, s.metric_name, s.metric_value);
        }
      }
      return updated;
    })();

    return toState(persisted);
  });

  app.get<{ Params: { playerId: string } }>('/api/practice/history/:playerId', async (req, reply) => {
    const playerId = parseInt(req.params.playerId, 10);
    if (!Number.isInteger(playerId)) return reply.code(400).send({ error: 'Invalid playerId' });
    if (!canAccess(req.player, playerId)) {
      return reply.code(403).send({ error: 'Not your practice history' });
    }
    const rows = db.prepare(
      `SELECT * FROM practice_history WHERE player_id = ? ORDER BY session_date DESC, id DESC LIMIT 100`
    ).all(playerId) as PracticeHistoryRow[];
    return rows.map((r) => ({
      id: r.id,
      drillType: r.drill_type,
      difficulty: r.difficulty,
      metricName: r.metric_name,
      metricValue: r.metric_value,
      sessionDate: r.session_date,
    }));
  });
}
