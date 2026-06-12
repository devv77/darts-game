import { describe, it, expect } from 'vitest';
import {
  nextPowerOfTwo, seedOrder, generateKnockout,
  generateRoundRobin, computeStandings, allMatchesDone,
  assignGroups, generateGroupStage, seedKnockoutFromGroups,
} from '../src/tournament-engine.js';

describe('nextPowerOfTwo', () => {
  it('rounds up to a power of two (min 2)', () => {
    expect(nextPowerOfTwo(2)).toBe(2);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });
});

describe('seedOrder', () => {
  it('produces the standard bracket order', () => {
    expect(seedOrder(2)).toEqual([1, 2]);
    expect(seedOrder(4)).toEqual([1, 4, 2, 3]);
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
  });

  it('keeps the top two seeds in opposite halves', () => {
    const order = seedOrder(8);
    const half = order.length / 2;
    const firstHalf = order.slice(0, half);
    expect(firstHalf).toContain(1);
    expect(firstHalf).not.toContain(2);
  });
});

describe('generateKnockout — power-of-two field (no byes)', () => {
  it('4 players → 3 matches; both first-round matches ready, final pending', () => {
    const m = generateKnockout([10, 20, 30, 40]); // seeds 1..4
    expect(m).toHaveLength(3);
    const r1 = m.filter((x) => x.roundNum === 1);
    const final = m.find((x) => x.roundNum === 2)!;
    expect(r1).toHaveLength(2);
    expect(r1.every((x) => x.status === 'ready')).toBe(true);
    expect(final.status).toBe('pending');
    expect(final.nextTempId).toBeNull();
    expect(final.nextSlot).toBeNull();
  });

  it('seeds 1 and 4 meet in match 0; 2 and 3 in match 1', () => {
    const m = generateKnockout([10, 20, 30, 40]);
    const r1 = m.filter((x) => x.roundNum === 1).sort((a, b) => a.matchIndex - b.matchIndex);
    expect([r1[0]!.homePlayerId, r1[0]!.awayPlayerId]).toEqual([10, 40]);
    expect([r1[1]!.homePlayerId, r1[1]!.awayPlayerId]).toEqual([20, 30]);
  });

  it('both first-round matches feed the final on opposite slots', () => {
    const m = generateKnockout([10, 20, 30, 40]);
    const r1 = m.filter((x) => x.roundNum === 1).sort((a, b) => a.matchIndex - b.matchIndex);
    const final = m.find((x) => x.roundNum === 2)!;
    expect(r1[0]!.nextTempId).toBe(final.tempId);
    expect(r1[1]!.nextTempId).toBe(final.tempId);
    expect(r1[0]!.nextSlot).toBe('home');
    expect(r1[1]!.nextSlot).toBe('away');
  });

  it('2 players → single match, no next, ready', () => {
    const m = generateKnockout([1, 2]);
    expect(m).toHaveLength(1);
    expect(m[0]!.status).toBe('ready');
    expect(m[0]!.nextTempId).toBeNull();
  });
});

describe('generateKnockout — byes (non-power-of-two)', () => {
  it('5 players pad to an 8-bracket; byes go to the top seeds', () => {
    const seeds = [101, 102, 103, 104, 105];
    const m = generateKnockout(seeds);
    // 8-bracket = 4 + 2 + 1 = 7 matches.
    expect(m).toHaveLength(7);
    const r1 = m.filter((x) => x.roundNum === 1);
    const byes = r1.filter((x) => x.status === 'bye');
    // 8 slots, 5 players → 3 byes, all on top seeds (1,2,3).
    expect(byes).toHaveLength(3);
    const byeWinners = byes.map((x) => x.winnerId).sort((a, b) => a! - b!);
    expect(byeWinners).toEqual([101, 102, 103]);
  });

  it('a bye auto-advances its player into the next match slot', () => {
    const m = generateKnockout([101, 102, 103, 104, 105]);
    const r1 = m.filter((x) => x.roundNum === 1);
    for (const bye of r1.filter((x) => x.status === 'bye')) {
      const nxt = m.find((x) => x.tempId === bye.nextTempId)!;
      const slotVal = bye.nextSlot === 'home' ? nxt.homePlayerId : nxt.awayPlayerId;
      expect(slotVal).toBe(bye.winnerId);
    }
  });

  it('the only real first-round match (seed 4 v 5) is ready', () => {
    const m = generateKnockout([101, 102, 103, 104, 105]);
    const real = m.filter((x) => x.roundNum === 1 && x.status === 'ready');
    expect(real).toHaveLength(1);
    expect([real[0]!.homePlayerId, real[0]!.awayPlayerId].sort()).toEqual([104, 105]);
  });

  it('a round-2 match fed by two byes becomes ready immediately', () => {
    // With 5 players, seeds 2 and 3 both get byes and meet in a round-2 match.
    const m = generateKnockout([101, 102, 103, 104, 105]);
    const readyR2 = m.filter((x) => x.roundNum === 2 && x.status === 'ready');
    expect(readyR2).toHaveLength(1);
    expect([readyR2[0]!.homePlayerId, readyR2[0]!.awayPlayerId].sort()).toEqual([102, 103]);
  });

  it('6 players → 2 byes for seeds 1 and 2', () => {
    const m = generateKnockout([1, 2, 3, 4, 5, 6]);
    const byes = m.filter((x) => x.roundNum === 1 && x.status === 'bye');
    expect(byes.map((b) => b.winnerId).sort((a, b) => a! - b!)).toEqual([1, 2]);
  });
});

describe('generateRoundRobin', () => {
  it('4 players single RR → 6 matches over 3 matchdays, each plays once per day', () => {
    const m = generateRoundRobin([1, 2, 3, 4], false);
    expect(m).toHaveLength(6);
    expect(new Set(m.map((x) => x.roundNum)).size).toBe(3);
    for (let day = 1; day <= 3; day++) {
      const dayMatches = m.filter((x) => x.roundNum === day);
      expect(dayMatches).toHaveLength(2);
      const seen = dayMatches.flatMap((x) => [x.homePlayerId, x.awayPlayerId]);
      expect(new Set(seen).size).toBe(4); // everyone plays exactly once
    }
  });

  it('every unique pair meets exactly once (single RR)', () => {
    const m = generateRoundRobin([1, 2, 3, 4, 5], false);
    const pairs = m.map((x) => [x.homePlayerId, x.awayPlayerId].sort((a, b) => a! - b!).join('-'));
    expect(new Set(pairs).size).toBe(pairs.length); // no repeats
    expect(pairs.length).toBe(10); // C(5,2)
  });

  it('odd field: one player sits out each matchday', () => {
    const m = generateRoundRobin([1, 2, 3], false);
    expect(m).toHaveLength(3); // C(3,2)
    expect(new Set(m.map((x) => x.roundNum)).size).toBe(3);
  });

  it('double RR doubles the fixtures and swaps home/away', () => {
    const single = generateRoundRobin([1, 2, 3, 4], false);
    const dbl = generateRoundRobin([1, 2, 3, 4], true);
    expect(dbl).toHaveLength(single.length * 2);
    expect(new Set(dbl.map((x) => x.roundNum)).size).toBe(6);
  });

  it('all matches are ready with no winner-path wiring', () => {
    const m = generateRoundRobin([1, 2, 3, 4]);
    expect(m.every((x) => x.status === 'ready' && x.nextTempId === null)).toBe(true);
  });
});

describe('computeStandings', () => {
  const seeds = [1, 2, 3].map((id) => ({ playerId: id, seed: id }));

  it('orders by points then leg diff then legs for then seed', () => {
    const matches = [
      { homePlayerId: 1, awayPlayerId: 2, homeLegs: 3, awayLegs: 1, winnerId: 1, status: 'completed' },
      { homePlayerId: 1, awayPlayerId: 3, homeLegs: 3, awayLegs: 0, winnerId: 1, status: 'completed' },
      { homePlayerId: 2, awayPlayerId: 3, homeLegs: 3, awayLegs: 2, winnerId: 2, status: 'completed' },
    ];
    const table = computeStandings(seeds, matches);
    expect(table[0]!.playerId).toBe(1); // 2 wins
    expect(table[0]!.points).toBe(4);
    expect(table[1]!.playerId).toBe(2); // 1 win
    expect(table[2]!.playerId).toBe(3); // 0 wins
    expect(table[0]!.legDiff).toBe(5);
  });

  it('ignores non-completed matches', () => {
    const matches = [
      { homePlayerId: 1, awayPlayerId: 2, homeLegs: 0, awayLegs: 0, winnerId: null, status: 'ready' },
    ];
    const table = computeStandings(seeds, matches);
    expect(table.every((r) => r.played === 0)).toBe(true);
  });

  it('respects a custom pointsWin', () => {
    const matches = [
      { homePlayerId: 1, awayPlayerId: 2, homeLegs: 3, awayLegs: 0, winnerId: 1, status: 'completed' },
    ];
    const table = computeStandings(seeds, matches, { pointsWin: 3 });
    expect(table.find((r) => r.playerId === 1)!.points).toBe(3);
  });
});

describe('allMatchesDone', () => {
  it('true only when every match is completed or bye', () => {
    expect(allMatchesDone([{ status: 'completed' }, { status: 'bye' }])).toBe(true);
    expect(allMatchesDone([{ status: 'completed' }, { status: 'ready' }])).toBe(false);
    expect(allMatchesDone([])).toBe(false);
  });
});

describe('assignGroups (snake draft)', () => {
  it('distributes 8 players into 2 groups, snaking', () => {
    const a = assignGroups([1, 2, 3, 4, 5, 6, 7, 8], 2);
    const groupOf = (id: number) => a.find((x) => x.playerId === id)!.group;
    expect(groupOf(1)).toBe('A');
    expect(groupOf(2)).toBe('B');
    expect(groupOf(3)).toBe('B'); // snake turns
    expect(groupOf(4)).toBe('A');
    // 4 per group
    expect(a.filter((x) => x.group === 'A')).toHaveLength(4);
    expect(a.filter((x) => x.group === 'B')).toHaveLength(4);
  });

  it('keeps top seeds spread across groups', () => {
    const a = assignGroups([1, 2, 3, 4, 5, 6], 3);
    expect(a.find((x) => x.playerId === 1)!.group).toBe('A');
    expect(a.find((x) => x.playerId === 2)!.group).toBe('B');
    expect(a.find((x) => x.playerId === 3)!.group).toBe('C');
  });
});

describe('generateGroupStage', () => {
  it('round-robins each group and tags stage/group', () => {
    const assignments = assignGroups([1, 2, 3, 4, 5, 6, 7, 8], 2);
    const m = generateGroupStage(assignments, false);
    // 2 groups of 4 → 6 matches each → 12.
    expect(m).toHaveLength(12);
    expect(m.every((x) => x.stage === 'group')).toBe(true);
    expect(new Set(m.map((x) => x.groupLabel))).toEqual(new Set(['A', 'B']));
    expect(new Set(m.map((x) => x.tempId)).size).toBe(12); // unique tempIds
  });
});

describe('seedKnockoutFromGroups', () => {
  it('lands A1 vs B2 and B1 vs A2 in round one (no same-group round-1 ties)', () => {
    const standings = [
      { group: 'A', rows: [{ playerId: 11 }, { playerId: 12 }] }, // A1=11, A2=12
      { group: 'B', rows: [{ playerId: 21 }, { playerId: 22 }] }, // B1=21, B2=22
    ];
    const seeds = seedKnockoutFromGroups(standings, 2);
    expect(seeds).toEqual([11, 21, 12, 22]); // winners A1,B1 then runners-up A2,B2
    const ko = generateKnockout(seeds);
    const r1 = ko.filter((x) => x.roundNum === 1).sort((a, b) => a.matchIndex - b.matchIndex);
    const pair0 = [r1[0]!.homePlayerId, r1[0]!.awayPlayerId];
    const pair1 = [r1[1]!.homePlayerId, r1[1]!.awayPlayerId];
    expect(pair0).toEqual([11, 22]); // A1 vs B2
    expect(pair1).toEqual([21, 12]); // B1 vs A2
  });

  it('4 groups × top 2 → no same-group round-1 matchups', () => {
    const groups = ['A', 'B', 'C', 'D'].map((g, gi) => ({
      group: g, rows: [{ playerId: gi * 10 + 1 }, { playerId: gi * 10 + 2 }],
    }));
    const seeds = seedKnockoutFromGroups(groups, 2);
    const ko = generateKnockout(seeds);
    const groupOf = (id: number) => Math.floor(id / 10);
    for (const m of ko.filter((x) => x.roundNum === 1)) {
      expect(groupOf(m.homePlayerId!)).not.toBe(groupOf(m.awayPlayerId!));
    }
  });
});

describe('generateKnockout — structural invariants', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 16]) {
    it(`every non-final match has a valid winner path (n=${n})`, () => {
      const seeds = Array.from({ length: n }, (_, i) => i + 1);
      const m = generateKnockout(seeds);
      const byTemp = new Map(m.map((x) => [x.tempId, x]));
      const finals = m.filter((x) => x.nextTempId === null);
      expect(finals).toHaveLength(1); // exactly one final
      for (const match of m) {
        if (match.nextTempId === null) continue;
        expect(byTemp.has(match.nextTempId)).toBe(true);
        expect(byTemp.get(match.nextTempId)!.roundNum).toBe(match.roundNum + 1);
        expect(match.nextSlot === 'home' || match.nextSlot === 'away').toBe(true);
      }
    });
  }
});
