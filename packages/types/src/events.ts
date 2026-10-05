/**
 * The event stream is the engine's only input and the audit trail for anti-cheat.
 *
 * Every event is recorded server-side. Nothing a client *claims* becomes an event: a client
 * sends keystrokes and flag submissions, and the server decides what those mean.
 */

export interface GameEventBase {
  readonly sessionId: string;
  readonly missionId: string;
  /** ISO-8601, assigned server-side. The engine never reads a clock itself. */
  readonly timestamp: string;
}

export type GameEvent =
  | (GameEventBase & { readonly type: 'MISSION_STARTED' })
  | (GameEventBase & {
      readonly type: 'COMMAND_EXECUTED';
      readonly command: string;
      /**
       * Working directory the command ran in, when the gateway could measure it. Optional:
       * the engine derives the effective directory from the `cd` history otherwise, and
       * prefers a measured value over its own when one is supplied.
       */
      readonly cwd?: string;
      /** Captured stdout/stderr, used to derive discoveries. May be empty. */
      readonly output?: string;
    })
  | (GameEventBase & { readonly type: 'FILE_FOUND'; readonly path: string })
  | (GameEventBase & { readonly type: 'TEXT_FOUND'; readonly text: string })
  | (GameEventBase & { readonly type: 'PORT_DISCOVERED'; readonly port: number })
  | (GameEventBase & {
      readonly type: 'HTTP_REQUEST';
      readonly method: string;
      readonly url: string;
      readonly status?: number;
    })
  | (GameEventBase & { readonly type: 'SERVICE_DISCOVERED'; readonly service: string })
  | (GameEventBase & { readonly type: 'LOG_ANALYSIS'; readonly evidence: string })
  | (GameEventBase & {
      readonly type: 'CONFIG_CHANGED';
      readonly key: string;
      readonly value: string;
    })
  | (GameEventBase & {
      readonly type: 'ANSWER_SUBMITTED';
      readonly answer: string;
      readonly correct: boolean;
    })
  | (GameEventBase & {
      readonly type: 'HINT_USED';
      readonly level: number;
      readonly xpCost: number;
    })
  | (GameEventBase & { readonly type: 'FLAG_SUBMITTED'; readonly correct: boolean })
  | (GameEventBase & { readonly type: 'MISSION_COMPLETED'; readonly score: number })
  | (GameEventBase & { readonly type: 'MISSION_FAILED'; readonly reason: string })
  | (GameEventBase & { readonly type: 'MISSION_ABANDONED' })
  | (GameEventBase & { readonly type: 'ACHIEVEMENT_UNLOCKED'; readonly achievement: string });

export type GameEventType = GameEvent['type'];

/** Narrowing helper, so consumers do not re-implement the discriminant check. */
export function isEventOfType<T extends GameEventType>(
  event: GameEvent,
  type: T,
): event is Extract<GameEvent, { type: T }> {
  return event.type === type;
}
