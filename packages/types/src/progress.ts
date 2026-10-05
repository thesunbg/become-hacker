import type { MissionSkillReward, MissionState } from './mission.js';

export interface TaskProgress {
  readonly taskId: string;
  readonly completed: boolean;
  readonly optional: boolean;
  /** ISO-8601 of the event that satisfied the task, when it has been satisfied. */
  readonly completedAt?: string;
  /** XP this task contributes once completed. */
  readonly xp: number;
}

export interface ScoreBreakdown {
  readonly missionXp: number;
  readonly taskXp: number;
  readonly bonusXp: number;
  readonly hintPenalty: number;
  readonly mistakePenalty: number;
  /** Mild-by-design floor: a player who finishes always keeps a meaningful share. */
  readonly floorApplied: boolean;
}

export interface MissionProgress {
  readonly missionId: string;
  readonly state: MissionState;
  readonly tasks: readonly TaskProgress[];
  readonly requiredTaskCount: number;
  readonly completedRequiredCount: number;
  readonly flagAccepted: boolean;
  readonly hintsUsed: readonly number[];
  readonly mistakes: number;
  readonly attempts: number;
  readonly elapsedSeconds: number;
}

export interface MissionResult {
  readonly missionId: string;
  readonly completed: boolean;
  readonly score: number;
  /** 0–5 stars. */
  readonly rating: number;
  readonly xpAwarded: number;
  readonly breakdown: ScoreBreakdown;
  readonly skills: readonly MissionSkillReward[];
  readonly elapsedSeconds: number;
  readonly hintsUsed: number;
  readonly mistakes: number;
}

export interface XpTransaction {
  readonly amount: number;
  readonly reason: string;
  readonly missionId?: string;
}
