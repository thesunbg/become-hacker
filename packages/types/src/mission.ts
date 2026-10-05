/**
 * Mission definitions. These mirror `content/mission.schema.json` — if you change one,
 * change the other, and `pnpm content:validate` will tell you if they drift.
 */

export const OBJECTIVE_TYPES = [
  'COMMAND',
  'FILE_FOUND',
  'TEXT_FOUND',
  'PORT_FOUND',
  'HTTP_REQUEST',
  'FLAG_FOUND',
  'ANSWER',
  'CONFIG_CHANGED',
  'SERVICE_DISCOVERED',
  'LOG_ANALYSIS',
] as const;

export type ObjectiveType = (typeof OBJECTIVE_TYPES)[number];

export const SKILL_IDS = [
  'LINUX',
  'NETWORKING',
  'WEB',
  'PROGRAMMING',
  'CRYPTOGRAPHY',
  'OSINT',
  'FORENSICS',
  'REVERSE_ENGINEERING',
  'CLOUD',
  'RED_TEAM',
  'BLUE_TEAM',
  'PROBLEM_SOLVING',
] as const;

export type SkillId = (typeof SKILL_IDS)[number];

export type EnvironmentType = 'terminal' | 'terminal+browser' | 'browser';

export interface MissionEnvironment {
  readonly type: EnvironmentType;
  /** Directory name under `labs/` providing this sandbox. */
  readonly image: string;
}

export interface MissionTask {
  readonly id: string;
  readonly type: ObjectiveType;
  /** Shown to the player as a checklist item. States what, never how. */
  readonly description: string;
  /** Path, command, port, string or answer the engine matches on. */
  readonly target?: string;
  /** Bonus objective: awards XP but is not required to complete the mission. */
  readonly optional?: boolean;
  readonly xp?: number;
}

export interface MissionHint {
  readonly level: number;
  readonly text: string;
  readonly xpCost: number;
}

export interface MissionKnowledge {
  readonly concept: string;
  readonly explanation: string;
  /** game concept -> security concept -> real world */
  readonly realWorld?: string;
}

export interface MissionSkillReward {
  readonly skill: SkillId;
  readonly amount: number;
}

/**
 * The full mission as authored in `content/`. **Server-side only** — it carries the flag.
 * Never return this type from a controller; see {@link PublicMission}.
 */
export interface MissionDefinition {
  readonly id: string;
  readonly chapter: number;
  readonly title: string;
  readonly difficulty: number;
  readonly estimatedMinutes: number;
  readonly story: string;
  readonly objective: string;
  readonly environment: MissionEnvironment;
  readonly tasks: readonly MissionTask[];
  readonly hints: readonly MissionHint[];
  /** Present only when the mission has a FLAG_FOUND task. NEVER sent to a client. */
  readonly flag?: string;
  readonly knowledge: readonly MissionKnowledge[];
  readonly skills: readonly MissionSkillReward[];
  readonly xp: number;
  /** Mission ids that must be COMPLETED before this one leaves LOCKED. */
  readonly requires?: readonly string[];
}

export const MISSION_STATES = [
  'LOCKED',
  'AVAILABLE',
  'STARTED',
  'IN_PROGRESS',
  'COMPLETED',
  'FAILED',
  'ABANDONED',
] as const;

export type MissionState = (typeof MISSION_STATES)[number];
