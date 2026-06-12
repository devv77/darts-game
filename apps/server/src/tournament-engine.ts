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
