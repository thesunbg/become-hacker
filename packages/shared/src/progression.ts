/**
 * The level curve and rank titles.
 *
 * Shared rather than duplicated: the API awards XP and the dashboard draws the bar, and if
 * the two disagreed a player would watch their level change when they reloaded the page.
 */

/** Level N costs this much more than level N-1, so progress slows without stalling. */
export const LEVEL_BASE_XP = 250;

/** Total XP required to reach a level. Level 1 is free. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return (LEVEL_BASE_XP * (level - 1) * level) / 2;
}

/** Inverse of {@link xpForLevel}. */
export function levelForXp(xp: number): number {
  const safe = Math.max(0, Number.isFinite(xp) ? xp : 0);
  if (safe <= 0) return 1;
  return Math.max(1, Math.floor((Math.sqrt(1 + (8 * safe) / LEVEL_BASE_XP) - 1) / 2) + 1);
}

export interface LevelProgress {
  readonly level: number;
  /** XP earned since reaching this level. */
  readonly into: number;
  /** XP this level spans. Never zero, so a caller can always divide by it. */
  readonly needed: number;
  /** 0–100, for a progress bar. */
  readonly percent: number;
}

export function levelProgress(xp: number): LevelProgress {
  const safe = Math.max(0, Number.isFinite(xp) ? xp : 0);
  const level = levelForXp(safe);
  const floor = xpForLevel(level);
  const needed = Math.max(1, xpForLevel(level + 1) - floor);
  const into = safe - floor;
  return {
    level,
    into,
    needed,
    percent: Math.min(100, Math.max(0, Math.round((into / needed) * 100))),
  };
}

/** The character arc from docs/01-vision.md. */
export const RANKS = [
  'Unknown',
  'Newbie',
  'Curious',
  'Script Kiddie',
  'Hacker',
  'Pentester',
  'Red Teamer',
  'Security Engineer',
  'Elite Hacker',
] as const;

export type Rank = (typeof RANKS)[number];

export function rankForLevel(level: number): Rank {
  const index = Math.min(RANKS.length - 1, Math.max(0, Math.floor(level) - 1));
  return RANKS[index] as Rank;
}
