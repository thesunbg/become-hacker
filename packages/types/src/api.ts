import type { PublicMission } from './public.js';
import type { MissionProgress, MissionResult } from './progress.js';

/** Request/response contracts shared by `apps/api` and `apps/web`. */

export interface RegisterRequest {
  readonly email: string;
  readonly username: string;
  readonly password: string;
}

export interface LoginRequest {
  readonly email: string;
  readonly password: string;
}

export interface SkillLevel {
  readonly skill: string;
  readonly value: number;
}

export interface MeResponse {
  readonly id: string;
  readonly email: string;
  readonly username: string;
  readonly level: number;
  /** Derived from the xp_transactions ledger, never stored as a counter. */
  readonly xp: number;
  readonly reputation: number;
  readonly skills: readonly SkillLevel[];
}

export interface ChapterSummary {
  readonly chapter: number;
  readonly title: string;
  readonly missionCount: number;
  readonly completedCount: number;
}

export interface MissionListResponse {
  readonly chapters: readonly ChapterSummary[];
  readonly missions: readonly PublicMission[];
}

export interface MissionDetailResponse {
  readonly mission: PublicMission;
  readonly progress: MissionProgress | null;
  readonly revealedHints: readonly { level: number; text: string }[];
}

export interface StartMissionResponse {
  readonly progress: MissionProgress;
}

export interface HintResponse {
  readonly level: number;
  readonly text: string;
  readonly xpCost: number;
}

export interface CreateLabResponse {
  readonly sessionId: string;
  readonly missionId: string;
  readonly expiresAt: string;
  /** Relative WebSocket path the client attaches the terminal to. */
  readonly terminalPath: string;
}

/** The lab a player currently has open, or null when there is none. */
export interface ActiveLabResponse {
  readonly lab: CreateLabResponse | null;
}

export interface SubmitFlagRequest {
  readonly value: string;
}

export interface SubmitFlagResponse {
  readonly correct: boolean;
  readonly progress: MissionProgress;
  /** Present only when this submission completed the mission. */
  readonly result: MissionResult | null;
}

export interface ProgressResponse {
  readonly missions: readonly MissionProgress[];
  readonly xp: number;
  readonly level: number;
}

/** Messages on the terminal WebSocket. */
export type TerminalClientMessage =
  | { readonly type: 'input'; readonly data: string }
  | { readonly type: 'resize'; readonly cols: number; readonly rows: number };

export type TerminalServerMessage =
  | { readonly type: 'output'; readonly data: string }
  | { readonly type: 'ready' }
  | { readonly type: 'progress'; readonly progress: MissionProgress }
  | { readonly type: 'closed'; readonly reason: string };
