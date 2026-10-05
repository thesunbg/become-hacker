import type {
  MissionDefinition,
  MissionEnvironment,
  MissionKnowledge,
  MissionSkillReward,
  MissionState,
  MissionTask,
  ObjectiveType,
} from './mission.js';

/**
 * Rule 4 of CLAUDE.md, expressed as a type: a flag must never reach the client.
 *
 * `ClientSafe<T>` fails to compile if `T` can carry a `flag` property, so a DTO that
 * forgets to strip it is a build error rather than a code-review catch.
 */
export type ClientSafe<T> = 'flag' extends keyof T ? never : T;

/** A task as the player sees it. `target` is withheld: it is usually the answer. */
export interface PublicMissionTask {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly description: string;
  readonly optional: boolean;
  readonly xp: number;
}

/** A hint the player has already paid for. Unrevealed hints are never sent. */
export interface RevealedHint {
  readonly level: number;
  readonly text: string;
  readonly xpCost: number;
}

/** Hint metadata the player needs in order to decide whether to buy the next one. */
export interface HintAvailability {
  readonly level: number;
  readonly xpCost: number;
  readonly revealed: boolean;
}

export interface PublicMission {
  readonly id: string;
  readonly chapter: number;
  readonly title: string;
  readonly difficulty: number;
  readonly estimatedMinutes: number;
  readonly story: string;
  readonly objective: string;
  readonly environment: MissionEnvironment;
  readonly tasks: readonly PublicMissionTask[];
  readonly hints: readonly HintAvailability[];
  readonly knowledge: readonly MissionKnowledge[];
  readonly skills: readonly MissionSkillReward[];
  readonly xp: number;
  readonly requires: readonly string[];
  readonly state: MissionState;
}

// Fails to compile if PublicMission ever grows a `flag`.
export type AssertPublicMissionIsSafe = ClientSafe<PublicMission>;

/**
 * Strips a mission down to what a client may see.
 *
 * Takes the full definition and returns a value whose type cannot hold a flag. Hint text is
 * included only for levels the player has already unlocked, and task targets are dropped
 * entirely — for a FILE_FOUND task the target *is* the solution.
 */
export function toPublicMission(
  mission: MissionDefinition,
  state: MissionState,
  revealedHintLevels: readonly number[] = [],
): PublicMission {
  return {
    id: mission.id,
    chapter: mission.chapter,
    title: mission.title,
    difficulty: mission.difficulty,
    estimatedMinutes: mission.estimatedMinutes,
    story: mission.story,
    objective: mission.objective,
    environment: mission.environment,
    tasks: mission.tasks.map((task) => ({
      id: task.id,
      type: task.type,
      description: task.description,
      optional: task.optional ?? false,
      xp: task.xp ?? 0,
    })),
    hints: mission.hints.map((hint) => ({
      level: hint.level,
      xpCost: hint.xpCost,
      revealed: revealedHintLevels.includes(hint.level),
    })),
    knowledge: mission.knowledge,
    skills: mission.skills,
    xp: mission.xp,
    requires: mission.requires ?? [],
    state,
  };
}

/** The knowledge review is only revealed once the mission is completed. */
export function withoutKnowledge(mission: PublicMission): PublicMission {
  return { ...mission, knowledge: [] };
}

export type { MissionEnvironment, MissionKnowledge, MissionSkillReward, MissionState, MissionTask };
