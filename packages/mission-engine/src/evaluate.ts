import type {
  GameEvent,
  MissionDefinition,
  MissionProgress,
  MissionState,
  MissionTask,
  TaskProgress,
} from '@zero-root/types';
import { commandLineSatisfies } from './command.js';
import { observeCommand } from './observe.js';
import { resolvePath } from './path.js';

export interface EvaluateOptions {
  /** Home directory inside the lab, used to resolve `~` and bare relative paths. */
  readonly home?: string;
  /** ISO-8601 "now", for elapsed time on a mission still in progress. Never read from a clock. */
  readonly now?: string;
}

/** Everything the engine has learned from the stream so far. */
interface Knowledge {
  readonly filesRead: Set<string>;
  readonly ports: Set<number>;
  readonly texts: string[];
  readonly services: Set<string>;
  readonly config: Map<string, string>;
  readonly httpRequests: { method: string; url: string }[];
  flagAccepted: boolean;
  correctAnswers: Set<string>;
  cwd: string;
}

function emptyKnowledge(home: string): Knowledge {
  return {
    filesRead: new Set(),
    ports: new Set(),
    texts: [],
    services: new Set(),
    config: new Map(),
    httpRequests: [],
    flagAccepted: false,
    correctAnswers: new Set(),
    cwd: home,
  };
}

function ingest(knowledge: Knowledge, event: GameEvent, home: string): void {
  switch (event.type) {
    case 'COMMAND_EXECUTED': {
      const cwd = event.cwd !== undefined && event.cwd !== '' ? event.cwd : knowledge.cwd;
      const derived = observeCommand(event.command, cwd, event.output, home);
      for (const file of derived.filesRead) knowledge.filesRead.add(file);
      for (const port of derived.ports) knowledge.ports.add(port);
      if (event.output !== undefined && event.output !== '') knowledge.texts.push(event.output);
      knowledge.cwd = derived.cwd;
      break;
    }
    case 'FILE_FOUND':
      knowledge.filesRead.add(resolvePath(knowledge.cwd, event.path, home));
      break;
    case 'TEXT_FOUND':
      knowledge.texts.push(event.text);
      break;
    case 'LOG_ANALYSIS':
      knowledge.texts.push(event.evidence);
      break;
    case 'PORT_DISCOVERED':
      knowledge.ports.add(event.port);
      break;
    case 'SERVICE_DISCOVERED':
      knowledge.services.add(event.service);
      break;
    case 'CONFIG_CHANGED':
      knowledge.config.set(event.key, event.value);
      break;
    case 'HTTP_REQUEST':
      knowledge.httpRequests.push({ method: event.method, url: event.url });
      break;
    case 'FLAG_SUBMITTED':
      if (event.correct) knowledge.flagAccepted = true;
      break;
    case 'ANSWER_SUBMITTED':
      if (event.correct) knowledge.correctAnswers.add(event.answer.trim().toLowerCase());
      break;
    default:
      break;
  }
}

/**
 * Is this task satisfied by what we know, plus the event we just saw?
 *
 * COMMAND is checked against the triggering event rather than accumulated knowledge, because
 * "ran this command" is about the act, not its result.
 */
function isSatisfied(
  task: MissionTask,
  knowledge: Knowledge,
  event: GameEvent,
  home: string,
): boolean {
  const target = task.target;

  switch (task.type) {
    case 'COMMAND':
      if (target === undefined) return false;
      return event.type === 'COMMAND_EXECUTED' && commandLineSatisfies(target, event.command);

    case 'FILE_FOUND': {
      if (target === undefined) return false;
      return knowledge.filesRead.has(resolvePath(home, target, home));
    }

    case 'TEXT_FOUND':
      if (target === undefined) return false;
      return knowledge.texts.some((text) => text.includes(target));

    case 'LOG_ANALYSIS':
      if (target === undefined) return false;
      return knowledge.texts.some((text) => text.includes(target));

    case 'PORT_FOUND': {
      if (target === undefined) return false;
      const port = Number.parseInt(target, 10);
      return Number.isFinite(port) && knowledge.ports.has(port);
    }

    case 'SERVICE_DISCOVERED':
      if (target === undefined) return false;
      return knowledge.services.has(target);

    case 'CONFIG_CHANGED': {
      if (target === undefined) return false;
      const [key, value] = target.split('=');
      if (key === undefined) return false;
      const actual = knowledge.config.get(key);
      return value === undefined ? actual !== undefined : actual === value;
    }

    case 'HTTP_REQUEST':
      if (target === undefined) return false;
      return knowledge.httpRequests.some((request) => request.url.includes(target));

    case 'FLAG_FOUND':
      return knowledge.flagAccepted;

    case 'ANSWER':
      if (target === undefined) return false;
      return knowledge.correctAnswers.has(target.trim().toLowerCase());

    default:
      return false;
  }
}

function secondsBetween(from: string, to: string): number {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * Replays an event stream against a mission definition.
 *
 * Pure: no I/O, no clock, no database. Given the same mission and the same events it always
 * returns the same progress, which is what lets the API treat it as the only authority on
 * whether a mission is done.
 */
export function evaluateMission(
  mission: MissionDefinition,
  events: readonly GameEvent[],
  options: EvaluateOptions = {},
): MissionProgress {
  const home = options.home ?? '/home/player';
  const knowledge = emptyKnowledge(home);

  const completedAt = new Map<string, string>();
  const hintsUsed: number[] = [];
  let mistakes = 0;
  let attempts = 0;
  let started: string | undefined;
  let last: string | undefined;
  let terminal: MissionState | undefined;

  const relevant = events.filter((event) => event.missionId === mission.id);

  for (const event of relevant) {
    last = event.timestamp;

    switch (event.type) {
      case 'MISSION_STARTED':
        attempts++;
        started ??= event.timestamp;
        break;
      case 'HINT_USED':
        if (!hintsUsed.includes(event.level)) hintsUsed.push(event.level);
        break;
      // A mistake is a wrong *assertion*, never a failed experiment. Exploring and getting
      // an error is the designed path (docs/01-vision.md), so errored commands cost nothing.
      case 'FLAG_SUBMITTED':
        if (!event.correct) mistakes++;
        break;
      case 'ANSWER_SUBMITTED':
        if (!event.correct) mistakes++;
        break;
      case 'MISSION_FAILED':
        terminal = 'FAILED';
        break;
      case 'MISSION_ABANDONED':
        terminal = 'ABANDONED';
        break;
      default:
        break;
    }

    ingest(knowledge, event, home);

    for (const task of mission.tasks) {
      if (completedAt.has(task.id)) continue;
      if (isSatisfied(task, knowledge, event, home)) {
        completedAt.set(task.id, event.timestamp);
      }
    }
  }

  const tasks: TaskProgress[] = mission.tasks.map((task) => {
    const at = completedAt.get(task.id);
    return {
      taskId: task.id,
      completed: at !== undefined,
      optional: task.optional ?? false,
      xp: task.xp ?? 0,
      ...(at !== undefined ? { completedAt: at } : {}),
    };
  });

  const required = tasks.filter((task) => !task.optional);
  const completedRequiredCount = required.filter((task) => task.completed).length;
  const allRequiredDone = required.length > 0 && completedRequiredCount === required.length;

  const now = options.now;
  const end = terminal !== undefined || allRequiredDone ? last : (now ?? last);
  const elapsedSeconds = started !== undefined && end !== undefined ? secondsBetween(started, end) : 0;

  let state: MissionState;
  if (allRequiredDone) {
    state = 'COMPLETED';
  } else if (terminal !== undefined) {
    state = terminal;
  } else if (started === undefined) {
    state = 'AVAILABLE';
  } else if (relevant.length > 1) {
    state = 'IN_PROGRESS';
  } else {
    state = 'STARTED';
  }

  return {
    missionId: mission.id,
    state,
    tasks,
    requiredTaskCount: required.length,
    completedRequiredCount,
    flagAccepted: knowledge.flagAccepted,
    hintsUsed: [...hintsUsed].sort((a, b) => a - b),
    mistakes,
    attempts,
    elapsedSeconds,
  };
}
