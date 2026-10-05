import type { MissionDefinition, MissionState } from '@zero-root/types';

/**
 * Whether a mission is reachable yet.
 *
 * Progression is the only gate: a mission is LOCKED until everything it names in `requires`
 * is completed. Unlocking is decided server-side from the player's own completion record —
 * a client asking to enter a locked lab is refused.
 */
export function isUnlocked(
  mission: MissionDefinition,
  completedMissionIds: readonly string[],
): boolean {
  return (mission.requires ?? []).every((required) => completedMissionIds.includes(required));
}

/**
 * Combines the unlock gate with recorded progress to get the state the player should see.
 * `recordedState` is whatever `evaluateMission` returned, or undefined if never started.
 */
export function missionState(
  mission: MissionDefinition,
  completedMissionIds: readonly string[],
  recordedState?: MissionState,
): MissionState {
  if (recordedState === 'COMPLETED') return 'COMPLETED';
  if (!isUnlocked(mission, completedMissionIds)) return 'LOCKED';
  return recordedState ?? 'AVAILABLE';
}

/** Orders missions the way the player should meet them. */
export function sortMissions(missions: readonly MissionDefinition[]): MissionDefinition[] {
  return [...missions].sort((a, b) => a.chapter - b.chapter || a.id.localeCompare(b.id));
}
