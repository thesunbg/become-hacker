/** Small display helpers, kept pure so they can be tested without a browser. */

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '00:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number): string => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
}

/** Difficulty as stars, the way the spec presents it. */
export function stars(count: number, total = 5): string {
  const filled = Math.max(0, Math.min(total, Math.round(count)));
  return '★'.repeat(filled) + '☆'.repeat(total - filled);
}

/**
 * The level curve and rank titles come from @zero-root/shared, so the bar this client draws
 * can never disagree with the XP the server awarded.
 */
export {
  LEVEL_BASE_XP,
  levelForXp,
  levelProgress,
  rankForLevel,
  xpForLevel,
} from '@zero-root/shared';
