import { describe, it, expect } from 'vitest';
import { DRILLS } from '../src/lib/practice';
import { MATCH_MODES, matchModeMeta } from '../src/lib/modes';

describe('practice DRILLS metadata (shared by Home / Setup / PracticePage)', () => {
  it('defines exactly the four drill types', () => {
    expect(DRILLS.map((d) => d.type).sort()).toEqual(
      ['around_the_clock', 'checkout', 'doubles', 'scoring']
    );
  });

  it('every drill has display metadata and a known input style', () => {
    for (const d of DRILLS) {
      expect(d.name).toBeTruthy();
      expect(d.icon).toBeTruthy();
      expect(d.description).toBeTruthy();
      expect(['darts', 'numpad']).toContain(d.input);
    }
  });

  it('only checkout offers a difficulty picker', () => {
    expect(DRILLS.filter((d) => d.hasDifficulty).map((d) => d.type)).toEqual(['checkout']);
  });

  it('scoring uses the numpad; the dart drills use the dart pad', () => {
    const input = Object.fromEntries(DRILLS.map((d) => [d.type, d.input]));
    expect(input.scoring).toBe('numpad');
    expect(input.checkout).toBe('darts');
    expect(input.around_the_clock).toBe('darts');
    expect(input.doubles).toBe('darts');
  });
});

describe('MATCH_MODES metadata (mode picker)', () => {
  it('defines exactly 501 / 301 / cricket / atc', () => {
    expect(MATCH_MODES.map((m) => m.mode)).toEqual(['501', '301', 'cricket', 'atc']);
  });

  it('every mode has display metadata', () => {
    for (const m of MATCH_MODES) {
      expect(m.name).toBeTruthy();
      expect(m.icon).toBeTruthy();
      expect(m.description).toBeTruthy();
    }
  });

  it('matchModeMeta resolves each mode by key', () => {
    expect(matchModeMeta('501').name).toBe('501');
    expect(matchModeMeta('301').name).toBe('301');
    expect(matchModeMeta('cricket').name).toBe('Cricket');
  });
});
