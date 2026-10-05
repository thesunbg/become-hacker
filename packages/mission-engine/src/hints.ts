import type { MissionDefinition, MissionHint } from '@zero-root/types';

/**
 * Hints are bought one at a time, in order.
 *
 * The escalation is the whole point: level 1 asks a question, and only the last level gives
 * syntax (docs/02-gameplay.md). Letting a player skip to the last hint would turn the system
 * into an answer key, so the next hint is always exactly one step further than the last.
 */
export function nextHint(
  mission: MissionDefinition,
  revealedLevels: readonly number[],
): MissionHint | null {
  const ordered = [...mission.hints].sort((a, b) => a.level - b.level);
  return ordered.find((hint) => !revealedLevels.includes(hint.level)) ?? null;
}

export function revealedHints(
  mission: MissionDefinition,
  revealedLevels: readonly number[],
): MissionHint[] {
  return mission.hints
    .filter((hint) => revealedLevels.includes(hint.level))
    .sort((a, b) => a.level - b.level);
}

export function hintsRemaining(
  mission: MissionDefinition,
  revealedLevels: readonly number[],
): number {
  return mission.hints.filter((hint) => !revealedLevels.includes(hint.level)).length;
}
