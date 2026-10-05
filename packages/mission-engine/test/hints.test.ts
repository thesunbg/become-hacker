import { describe, expect, it } from 'vitest';
import { hintsRemaining, nextHint, revealedHints } from '../src/hints.js';
import { mission } from './helpers.js';

describe('nextHint', () => {
  it('starts at the gentlest hint', () => {
    expect(nextHint(mission(), [])?.level).toBe(1);
  });

  it('hands out the next level in order', () => {
    expect(nextHint(mission(), [1])?.level).toBe(2);
  });

  it('cannot be skipped ahead to the hint containing the syntax', () => {
    // The player has paid for nothing, so they get level 1 — not the answer.
    const hint = nextHint(mission(), []);
    expect(hint?.text).toBe('think');
  });

  it('fills a gap rather than running ahead', () => {
    expect(nextHint(mission(), [2, 3])?.level).toBe(1);
  });

  it('returns null once every hint is revealed', () => {
    expect(nextHint(mission(), [1, 2, 3])).toBeNull();
  });

  it('orders by level even when the content is authored out of order', () => {
    const m = mission({
      hints: [
        { level: 3, text: 'c', xpCost: 20 },
        { level: 1, text: 'a', xpCost: 5 },
        { level: 2, text: 'b', xpCost: 10 },
      ],
    });
    expect(nextHint(m, [])?.level).toBe(1);
  });
});

describe('revealedHints', () => {
  it('returns only what the player has paid for, in order', () => {
    expect(revealedHints(mission(), [2, 1]).map((hint) => hint.level)).toEqual([1, 2]);
  });

  it('returns nothing when no hint was bought', () => {
    expect(revealedHints(mission(), [])).toEqual([]);
  });
});

describe('hintsRemaining', () => {
  it('counts what is left', () => {
    expect(hintsRemaining(mission(), [1])).toBe(2);
    expect(hintsRemaining(mission(), [1, 2, 3])).toBe(0);
  });
});
