import { describe, expect, it } from 'vitest';
import {
  LEVEL_BASE_XP,
  RANKS,
  levelForXp,
  levelProgress,
  rankForLevel,
  xpForLevel,
} from '../src/progression.js';

describe('xpForLevel and levelForXp', () => {
  it('makes level 1 free', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(xpForLevel(0)).toBe(0);
    expect(levelForXp(0)).toBe(1);
  });

  it('are inverses of each other at every boundary', () => {
    for (let level = 1; level <= 40; level++) {
      const threshold = xpForLevel(level);
      expect(levelForXp(threshold)).toBe(level);
      if (threshold > 0) expect(levelForXp(threshold - 1)).toBe(level - 1);
    }
  });

  it('costs more for each level than the one before', () => {
    for (let level = 2; level < 30; level++) {
      const span = xpForLevel(level + 1) - xpForLevel(level);
      const previous = xpForLevel(level) - xpForLevel(level - 1);
      expect(span).toBeGreaterThan(previous);
    }
  });

  it('puts the first level-up one base cost away', () => {
    expect(xpForLevel(2)).toBe(LEVEL_BASE_XP);
    expect(levelForXp(LEVEL_BASE_XP - 1)).toBe(1);
    expect(levelForXp(LEVEL_BASE_XP)).toBe(2);
  });

  it('never goes backwards', () => {
    let previous = 0;
    for (let xp = 0; xp < 100_000; xp += 131) {
      const level = levelForXp(xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      previous = level;
    }
  });

  it('treats nonsense as nothing earned, rather than producing NaN', () => {
    expect(levelForXp(-500)).toBe(1);
    expect(levelForXp(Number.NaN)).toBe(1);
    expect(levelForXp(Number.POSITIVE_INFINITY)).toBe(1);
  });
});

describe('levelProgress', () => {
  it('reports nothing earned at the start', () => {
    expect(levelProgress(0)).toEqual({ level: 1, into: 0, needed: LEVEL_BASE_XP, percent: 0 });
  });

  it('reports the fraction into the current level', () => {
    const progress = levelProgress(125);
    expect(progress.level).toBe(1);
    expect(progress.into).toBe(125);
    expect(progress.percent).toBe(50);
  });

  it('resets to the bottom of the next level on a level-up', () => {
    const progress = levelProgress(LEVEL_BASE_XP);
    expect(progress.level).toBe(2);
    expect(progress.into).toBe(0);
    expect(progress.percent).toBe(0);
  });

  it('stays in range and divisible for any input', () => {
    for (const xp of [-1, 0, 1, 249, 250, 10_000, 1_000_000, Number.NaN]) {
      const progress = levelProgress(xp);
      expect(progress.percent).toBeGreaterThanOrEqual(0);
      expect(progress.percent).toBeLessThanOrEqual(100);
      expect(progress.needed).toBeGreaterThan(0);
      expect(progress.into).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('rankForLevel', () => {
  it('opens on Unknown, because the player starts as nobody', () => {
    expect(rankForLevel(1)).toBe('Unknown');
  });

  it('walks the arc from the vision document', () => {
    expect(RANKS.map((_, index) => rankForLevel(index + 1))).toEqual([...RANKS]);
  });

  it('caps at the top instead of running off the end', () => {
    expect(rankForLevel(1_000)).toBe('Elite Hacker');
  });

  it('clamps a level below one', () => {
    expect(rankForLevel(0)).toBe('Unknown');
    expect(rankForLevel(-3)).toBe('Unknown');
  });
});
