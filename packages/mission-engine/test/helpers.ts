import type { GameEvent, MissionDefinition } from '@zero-root/types';

export const SESSION = 'session-1';

/** Builds an event stream with monotonically increasing timestamps, one second apart. */
export class Stream {
  private seconds = 0;

  constructor(
    private readonly missionId: string,
    private readonly start = Date.parse('2026-01-01T12:00:00.000Z'),
  ) {}

  private at(): string {
    return new Date(this.start + this.seconds * 1000).toISOString();
  }

  /** Advances the clock without emitting an event. */
  wait(seconds: number): this {
    this.seconds += seconds;
    return this;
  }

  private base() {
    this.seconds += 1;
    return { sessionId: SESSION, missionId: this.missionId, timestamp: this.at() };
  }

  events: GameEvent[] = [];

  started(): this {
    this.events.push({ ...this.base(), type: 'MISSION_STARTED' });
    return this;
  }

  run(command: string, output?: string, cwd?: string): this {
    this.events.push({
      ...this.base(),
      type: 'COMMAND_EXECUTED',
      command,
      ...(cwd !== undefined ? { cwd } : {}),
      ...(output !== undefined ? { output } : {}),
    });
    return this;
  }

  hint(level: number, xpCost: number): this {
    this.events.push({ ...this.base(), type: 'HINT_USED', level, xpCost });
    return this;
  }

  flag(correct: boolean): this {
    this.events.push({ ...this.base(), type: 'FLAG_SUBMITTED', correct });
    return this;
  }

  answer(answer: string, correct: boolean): this {
    this.events.push({ ...this.base(), type: 'ANSWER_SUBMITTED', answer, correct });
    return this;
  }

  port(port: number): this {
    this.events.push({ ...this.base(), type: 'PORT_DISCOVERED', port });
    return this;
  }

  file(path: string): this {
    this.events.push({ ...this.base(), type: 'FILE_FOUND', path });
    return this;
  }

  text(text: string): this {
    this.events.push({ ...this.base(), type: 'TEXT_FOUND', text });
    return this;
  }

  log(evidence: string): this {
    this.events.push({ ...this.base(), type: 'LOG_ANALYSIS', evidence });
    return this;
  }

  service(service: string): this {
    this.events.push({ ...this.base(), type: 'SERVICE_DISCOVERED', service });
    return this;
  }

  config(key: string, value: string): this {
    this.events.push({ ...this.base(), type: 'CONFIG_CHANGED', key, value });
    return this;
  }

  http(method: string, url: string, status?: number): this {
    this.events.push({
      ...this.base(),
      type: 'HTTP_REQUEST',
      method,
      url,
      ...(status !== undefined ? { status } : {}),
    });
    return this;
  }

  completedEvent(score: number): this {
    this.events.push({ ...this.base(), type: 'MISSION_COMPLETED', score });
    return this;
  }

  achievement(achievement: string): this {
    this.events.push({ ...this.base(), type: 'ACHIEVEMENT_UNLOCKED', achievement });
    return this;
  }

  abandoned(): this {
    this.events.push({ ...this.base(), type: 'MISSION_ABANDONED' });
    return this;
  }

  failed(reason = 'timeout'): this {
    this.events.push({ ...this.base(), type: 'MISSION_FAILED', reason });
    return this;
  }
}

export function mission(overrides: Partial<MissionDefinition> = {}): MissionDefinition {
  return {
    id: 'ch01-mission-001',
    chapter: 1,
    title: 'Test Mission',
    difficulty: 1,
    estimatedMinutes: 10,
    story: 'story',
    objective: 'objective',
    environment: { type: 'terminal', image: 'linux-basic' },
    tasks: [{ id: 't1', type: 'COMMAND', description: 'run whoami', target: 'whoami', xp: 10 }],
    hints: [
      { level: 1, text: 'think', xpCost: 5 },
      { level: 2, text: 'concept', xpCost: 10 },
      { level: 3, text: 'syntax', xpCost: 20 },
    ],
    knowledge: [{ concept: 'c', explanation: 'e' }],
    skills: [{ skill: 'LINUX', amount: 5 }],
    xp: 100,
    ...overrides,
  };
}
