import type { TournamentMatchStatus } from './types.js';

// Pure tournament logic — no DB, no I/O (mirrors practice-engine.ts). The store
// layer persists these structures and the routes/seam call into them.

/**
 * A match as produced by a generator, before persistence. `tempId` is the index
 * the store uses to wire `nextMatchId` (it maps tempId → the real autoincrement
 * id after insert). Pure functions never see real DB ids.
 */
export interface GeneratedMatch {
  tempId: number;
  stage: 'ko' | 'group' | 'league';
  groupLabel: string | null;
  roundNum: number;
  matchIndex: number;
  homePlayerId: number | null;
  awayPlayerId: number | null;
  winnerId: number | null;
  status: TournamentMatchStatus;
  nextTempId: number | null;
  nextSlot: 'home' | 'away' | null;
}

/** Smallest power of two ≥ n (min 2). */
export function nextPowerOfTwo(n: number): number {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard single-elimination seed order for a bracket of `size` (a power of
 * two). Returns 1-based seed numbers laid out so consecutive pairs are the
 * first-round matchups and the top two seeds sit in opposite halves.
 * size 2 → [1,2]; 4 → [1,4,2,3]; 8 → [1,8,4,5,2,7,3,6].
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const s of order) {
      next.push(s);
      next.push(sum - s);
    }
    order = next;
  }
  return order;
}

/**
 * Build a full single-elimination bracket from players in seed order
 * (`seeds[0]` = seed 1). Pads to the next power of two with byes assigned to the
 * top seeds, wires every winner path via `nextTempId`/`nextSlot`, marks
 * playable first-round matches `ready`, resolves byes (auto-advancing their
 * player), and leaves later rounds `pending` until both feeders settle.
 */
export function generateKnockout(seeds: number[]): GeneratedMatch[] {
  if (seeds.length < 2) throw new Error('Knockout needs at least 2 players');
  const size = nextPowerOfTwo(seeds.length);
  const order = seedOrder(size);
  const seedToPlayer = (seed: number): number | null =>
    seed <= seeds.length ? seeds[seed - 1]! : null;

  const rounds = Math.log2(size);
  const matches: GeneratedMatch[] = [];
  // tempId offset where each round's matches start.
  const roundOffset: number[] = [];
  let offset = 0;
  for (let r = 1; r <= rounds; r++) {
    roundOffset[r] = offset;
    offset += size / 2 ** r;
  }

  for (let r = 1; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let j = 0; j < count; j++) {
      const tempId = roundOffset[r]! + j;
      const isFinal = r === rounds;
      const nextTempId = isFinal ? null : roundOffset[r + 1]! + Math.floor(j / 2);
      const nextSlot: 'home' | 'away' | null = isFinal ? null : (j % 2 === 0 ? 'home' : 'away');

      let homePlayerId: number | null = null;
      let awayPlayerId: number | null = null;
      if (r === 1) {
        homePlayerId = seedToPlayer(order[2 * j]!);
        awayPlayerId = seedToPlayer(order[2 * j + 1]!);
      }
      matches.push({
        tempId, stage: 'ko', groupLabel: null,
        roundNum: r, matchIndex: j,
        homePlayerId, awayPlayerId, winnerId: null,
        status: r === 1 ? 'ready' : 'pending',
        nextTempId, nextSlot,
      });
    }
  }

  // Resolve byes: a first-round match with exactly one player auto-advances them.
  for (const m of matches) {
    if (m.roundNum !== 1) continue;
    const present = m.homePlayerId ?? m.awayPlayerId;
    const both = m.homePlayerId !== null && m.awayPlayerId !== null;
    if (!both && present !== null) {
      m.status = 'bye';
      m.winnerId = present;
      if (m.nextTempId !== null) {
        const nxt = matches[m.nextTempId]!;
        if (m.nextSlot === 'home') nxt.homePlayerId = present;
        else nxt.awayPlayerId = present;
      }
    }
  }
  // A pending match whose both slots are now filled (e.g. fed by two byes) is ready.
  for (const m of matches) {
    if (m.status === 'pending' && m.homePlayerId !== null && m.awayPlayerId !== null) {
      m.status = 'ready';
    }
  }

  return matches;
}

// ── League (round-robin) ────────────────────────────────────────────────────

/**
 * Balanced round-robin via the circle method. Each matchday (`roundNum`) gives
 * every player at most one game; with an odd field one player sits out per
 * matchday. `double` plays the reverse fixtures too (home/away swapped). All
 * matches are independent → `ready` with no winner-path wiring.
 */
export function generateRoundRobin(playerIds: number[], double = false): GeneratedMatch[] {
  if (playerIds.length < 2) throw new Error('League needs at least 2 players');
  const ids: (number | null)[] = [...playerIds];
  if (ids.length % 2 !== 0) ids.push(null); // bye sentinel
  const n = ids.length;
  const half = n / 2;
  const matches: GeneratedMatch[] = [];
  let tempId = 0;
  let arr = ids.slice();

  for (let r = 0; r < n - 1; r++) {
    let mi = 0;
    for (let i = 0; i < half; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home !== null && away !== null) {
        matches.push({
          tempId: tempId++, stage: 'league', groupLabel: null,
          roundNum: r + 1, matchIndex: mi++,
          homePlayerId: home, awayPlayerId: away, winnerId: null,
          status: 'ready', nextTempId: null, nextSlot: null,
        });
      }
    }
    // Rotate everything but the fixed first element.
    arr = [arr[0]!, arr[n - 1]!, ...arr.slice(1, n - 1)];
  }

  if (double) {
    const firstLeg = matches.slice();
    const matchdays = n - 1;
    for (const m of firstLeg) {
      matches.push({
        ...m, tempId: tempId++,
        roundNum: m.roundNum + matchdays,
        homePlayerId: m.awayPlayerId, awayPlayerId: m.homePlayerId,
      });
    }
  }
  return matches;
}

export interface StandingsSeed { playerId: number; seed: number }
export interface CompletedResult {
  homePlayerId: number | null;
  awayPlayerId: number | null;
  homeLegs: number;
  awayLegs: number;
  winnerId: number | null;
  status: string;
}
export interface StandingsRow {
  playerId: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  legsFor: number;
  legsAgainst: number;
  legDiff: number;
  points: number;
}

/**
 * Derive league standings from completed matches. Sort order (fixed for v1):
 * points → leg difference → legs for → seed. (Head-to-head is deferred.)
 */
export function computeStandings(
  seeds: StandingsSeed[],
  matches: CompletedResult[],
  opts: { pointsWin?: number; pointsDraw?: number } = {}
): StandingsRow[] {
  const pointsWin = opts.pointsWin ?? 2;
  const pointsDraw = opts.pointsDraw ?? 1;
  const rows = new Map<number, StandingsRow>();
  for (const s of seeds) {
    rows.set(s.playerId, { playerId: s.playerId, played: 0, won: 0, drawn: 0, lost: 0, legsFor: 0, legsAgainst: 0, legDiff: 0, points: 0 });
  }

  for (const m of matches) {
    if (m.status !== 'completed') continue;
    if (m.homePlayerId === null || m.awayPlayerId === null) continue;
    const home = rows.get(m.homePlayerId);
    const away = rows.get(m.awayPlayerId);
    if (!home || !away) continue;
    home.played++; away.played++;
    home.legsFor += m.homeLegs; home.legsAgainst += m.awayLegs;
    away.legsFor += m.awayLegs; away.legsAgainst += m.homeLegs;
    if (m.winnerId === null) {
      home.drawn++; away.drawn++;
      home.points += pointsDraw; away.points += pointsDraw;
    } else if (m.winnerId === m.homePlayerId) {
      home.won++; away.lost++; home.points += pointsWin;
    } else {
      away.won++; home.lost++; away.points += pointsWin;
    }
  }

  const seedOf = new Map(seeds.map((s) => [s.playerId, s.seed]));
  return [...rows.values()]
    .map((r) => ({ ...r, legDiff: r.legsFor - r.legsAgainst }))
    .sort((a, b) =>
      b.points - a.points ||
      b.legDiff - a.legDiff ||
      b.legsFor - a.legsFor ||
      (seedOf.get(a.playerId)! - seedOf.get(b.playerId)!)
    );
}

/** True once every match in the list is settled (`completed` or `bye`). */
export function allMatchesDone(matches: { status: string }[]): boolean {
  return matches.length > 0 && matches.every((m) => m.status === 'completed' || m.status === 'bye');
}

// ── Groups → Knockout ───────────────────────────────────────────────────────

export const groupLabel = (i: number): string => String.fromCharCode(65 + i); // 0→'A'

/** Snake-draft players (in seed order) into `groupCount` groups: A B C C B A A B C … */
export function assignGroups(playerIds: number[], groupCount: number): { playerId: number; group: string }[] {
  if (groupCount < 1) throw new Error('Need at least 1 group');
  const out: { playerId: number; group: string }[] = [];
  let idx = 0, dir = 1;
  for (const pid of playerIds) {
    out.push({ playerId: pid, group: groupLabel(idx) });
    idx += dir;
    if (idx >= groupCount) { idx = groupCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return out;
}

/** Round-robin within every group; matches are `stage: 'group'` and carry the group label. */
export function generateGroupStage(
  assignments: { playerId: number; group: string }[],
  double = false
): GeneratedMatch[] {
  const byGroup = new Map<string, number[]>();
  for (const a of assignments) {
    if (!byGroup.has(a.group)) byGroup.set(a.group, []);
    byGroup.get(a.group)!.push(a.playerId);
  }
  const matches: GeneratedMatch[] = [];
  let tempId = 0;
  for (const group of [...byGroup.keys()].sort()) {
    const ids = byGroup.get(group)!;
    if (ids.length < 2) continue; // a 1-player group has no fixtures
    for (const m of generateRoundRobin(ids, double)) {
      matches.push({ ...m, tempId: tempId++, stage: 'group', groupLabel: group });
    }
  }
  return matches;
}

/**
 * Cross-seed group qualifiers into a knockout bracket: all group winners first
 * (in group order), then all runners-up, etc. `generateKnockout` then pairs
 * seed1-vs-last and seed2-vs-third, which lands A1 vs B2 and B1 vs A2 in round
 * one and keeps same-group qualifiers in opposite halves until the final.
 */
export function seedKnockoutFromGroups(
  standingsByGroup: { group: string; rows: { playerId: number }[] }[],
  advancePerGroup: number
): number[] {
  const groups = [...standingsByGroup].sort((a, b) => a.group.localeCompare(b.group));
  const seedList: number[] = [];
  for (let pos = 0; pos < advancePerGroup; pos++) {
    for (const g of groups) {
      const row = g.rows[pos];
      if (row) seedList.push(row.playerId);
    }
  }
  return seedList;
}
