import { describe, it, expect } from 'vitest';
import { x01VisitState } from '../src/lib/darts';

describe('x01VisitState (dart-by-dart pad)', () => {
  it('double-out', () => {
    expect(x01VisitState(40, ['D20'], true)).toBe('checkout');
    expect(x01VisitState(40, ['S20', 'S20'], true)).toBe('bust');
    expect(x01VisitState(41, ['S20', 'S20'], true)).toBe('bust');
    expect(x01VisitState(50, ['DB'], true)).toBe('checkout');
    expect(x01VisitState(60, ['S20'], true)).toBe('open');
  });
  it('single-out', () => {
    expect(x01VisitState(40, ['S20', 'S20'], false)).toBe('checkout');
    expect(x01VisitState(21, ['S20'], false)).toBe('open');
    expect(x01VisitState(20, ['T20'], false)).toBe('bust');
  });
});
