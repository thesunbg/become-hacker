import { describe, expect, it } from 'vitest';
import { evaluateMission } from '../src/evaluate.js';
import { Stream, mission } from './helpers.js';

const taskDone = (progress: ReturnType<typeof evaluateMission>, id: string): boolean =>
  progress.tasks.find((task) => task.taskId === id)?.completed ?? false;

describe('evaluateMission — state machine', () => {
  it('reports AVAILABLE before the mission is started', () => {
    expect(evaluateMission(mission(), []).state).toBe('AVAILABLE');
  });

  it('reports STARTED on the start event alone', () => {
    const stream = new Stream('ch01-mission-001').started();
    expect(evaluateMission(mission(), stream.events).state).toBe('STARTED');
  });

  it('reports IN_PROGRESS once the player has acted', () => {
    const stream = new Stream('ch01-mission-001').started().run('ls', 'a b');
    expect(evaluateMission(mission(), stream.events).state).toBe('IN_PROGRESS');
  });

  it('reports COMPLETED when every required task is satisfied', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    expect(evaluateMission(mission(), stream.events).state).toBe('COMPLETED');
  });

  it('reports IN_PROGRESS for activity with no start event on record', () => {
    // A flag submitted from the mission page, before any lab was opened.
    const stream = new Stream('ch01-mission-001').flag(false);
    expect(evaluateMission(mission(), stream.events).state).toBe('IN_PROGRESS');
  });

  it('reports IN_PROGRESS for a hint bought before starting', () => {
    const stream = new Stream('ch01-mission-001').hint(1, 5);
    expect(evaluateMission(mission(), stream.events).state).toBe('IN_PROGRESS');
  });

  it('reports ABANDONED when the player walked away unfinished', () => {
    const stream = new Stream('ch01-mission-001').started().abandoned();
    expect(evaluateMission(mission(), stream.events).state).toBe('ABANDONED');
  });

  it('reports FAILED when the session failed unfinished', () => {
    const stream = new Stream('ch01-mission-001').started().failed();
    expect(evaluateMission(mission(), stream.events).state).toBe('FAILED');
  });

  it('lets completion win over a later abandon, because the work was done', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player').abandoned();
    expect(evaluateMission(mission(), stream.events).state).toBe('COMPLETED');
  });

  it('ignores events belonging to another mission', () => {
    const other = new Stream('ch01-mission-999').started().run('whoami', 'player');
    expect(evaluateMission(mission(), other.events).state).toBe('AVAILABLE');
  });
});

describe('evaluateMission — objective types', () => {
  it('satisfies COMMAND from the act of running it, whatever it printed', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami');
    expect(taskDone(evaluateMission(mission(), stream.events), 't1')).toBe(true);
  });

  it('satisfies FILE_FOUND from a successful read', () => {
    const m = mission({
      tasks: [
        {
          id: 'f',
          type: 'FILE_FOUND',
          description: 'read it',
          target: '/home/player/.null/first_contact',
        },
      ],
    });
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat .null/first_contact', 'ZR{...}');
    expect(taskDone(evaluateMission(m, stream.events), 'f')).toBe(true);
  });

  it('does not satisfy FILE_FOUND when the read failed', () => {
    const m = mission({
      tasks: [
        { id: 'f', type: 'FILE_FOUND', description: 'read it', target: '/home/player/.secret' },
      ],
    });
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat .secret', 'cat: .secret: No such file or directory');
    expect(taskDone(evaluateMission(m, stream.events), 'f')).toBe(false);
  });

  it('satisfies TEXT_FOUND when the string surfaces in output', () => {
    const m = mission({
      tasks: [{ id: 'x', type: 'TEXT_FOUND', description: 'find it', target: 'NULL' }],
    });
    const stream = new Stream('ch01-mission-001').started().run('cat f', 'We are called NULL.');
    expect(taskDone(evaluateMission(m, stream.events), 'x')).toBe(true);
  });

  it('satisfies PORT_FOUND from a reported discovery', () => {
    const m = mission({
      tasks: [{ id: 'p', type: 'PORT_FOUND', description: 'find 80', target: '80' }],
    });
    const stream = new Stream('ch01-mission-001').started().port(80);
    expect(taskDone(evaluateMission(m, stream.events), 'p')).toBe(true);
  });

  it('satisfies FLAG_FOUND only on a correct submission', () => {
    const m = mission({
      tasks: [{ id: 'g', type: 'FLAG_FOUND', description: 'submit' }],
      flag: 'ZR{x}',
    });
    const wrong = new Stream('ch01-mission-001').started().flag(false);
    expect(taskDone(evaluateMission(m, wrong.events), 'g')).toBe(false);

    const right = new Stream('ch01-mission-001').started().flag(true);
    expect(taskDone(evaluateMission(m, right.events), 'g')).toBe(true);
  });

  it('satisfies ANSWER case-insensitively', () => {
    const m = mission({
      tasks: [{ id: 'a', type: 'ANSWER', description: 'answer', target: 'HTTP' }],
    });
    const stream = new Stream('ch01-mission-001').started().answer('http', true);
    expect(taskDone(evaluateMission(m, stream.events), 'a')).toBe(true);
  });

  it('never satisfies a task whose target the author forgot', () => {
    const m = mission({
      tasks: [{ id: 'broken', type: 'FILE_FOUND', description: 'no target' }],
    });
    const stream = new Stream('ch01-mission-001').started().run('cat anything', 'out');
    expect(taskDone(evaluateMission(m, stream.events), 'broken')).toBe(false);
  });
});

describe('evaluateMission — optional tasks', () => {
  const m = mission({
    tasks: [
      { id: 'req', type: 'COMMAND', description: 'required', target: 'whoami', xp: 10 },
      {
        id: 'bonus',
        type: 'COMMAND',
        description: 'bonus',
        target: 'find',
        optional: true,
        xp: 25,
      },
    ],
  });

  it('completes the mission without the optional task', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    const progress = evaluateMission(m, stream.events);
    expect(progress.state).toBe('COMPLETED');
    expect(progress.requiredTaskCount).toBe(1);
    expect(taskDone(progress, 'bonus')).toBe(false);
  });

  it('still records the optional task when the player goes further', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('whoami', 'player')
      .run('find / -name .secret', '/home/player/.secret');
    expect(taskDone(evaluateMission(m, stream.events), 'bonus')).toBe(true);
  });
});

describe('evaluateMission — hints, mistakes and attempts', () => {
  it('records each hint once, in order', () => {
    const stream = new Stream('ch01-mission-001').started().hint(2, 10).hint(1, 5).hint(2, 10);
    expect(evaluateMission(mission(), stream.events).hintsUsed).toEqual([1, 2]);
  });

  it('counts a wrong flag as a mistake', () => {
    const stream = new Stream('ch01-mission-001').started().flag(false).flag(false);
    expect(evaluateMission(mission(), stream.events).mistakes).toBe(2);
  });

  it('does not count a correct submission as a mistake', () => {
    const stream = new Stream('ch01-mission-001').started().flag(true);
    expect(evaluateMission(mission(), stream.events).mistakes).toBe(0);
  });

  it('does not punish a failed experiment — that is the designed path', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat .secret', 'cat: .secret: No such file or directory')
      .run('ls /root', 'ls: /root: Permission denied')
      .run('frobnicate', 'frobnicate: command not found');
    expect(evaluateMission(mission(), stream.events).mistakes).toBe(0);
  });

  it('counts each start as an attempt', () => {
    const stream = new Stream('ch01-mission-001').started().abandoned().started();
    expect(evaluateMission(mission(), stream.events).attempts).toBe(2);
  });
});

describe('evaluateMission — elapsed time', () => {
  it('measures from the first start to the last event', () => {
    const stream = new Stream('ch01-mission-001').started().wait(60).run('whoami', 'player');
    // one second per event, plus the explicit 60s wait
    expect(evaluateMission(mission(), stream.events).elapsedSeconds).toBe(61);
  });

  it('measures an unfinished mission against the supplied now', () => {
    const stream = new Stream('ch01-mission-001').started();
    const progress = evaluateMission(mission(), stream.events, {
      now: '2026-01-01T12:05:01.000Z',
    });
    expect(progress.elapsedSeconds).toBe(300);
  });

  it('stops the clock at completion, so reading the review costs nothing', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    const progress = evaluateMission(mission(), stream.events, {
      now: '2026-01-01T23:00:00.000Z',
    });
    // Start and solve are one second apart; `now` hours later must not inflate that.
    expect(progress.elapsedSeconds).toBe(1);
  });
});

describe('evaluateMission — purity', () => {
  it('returns the same result for the same input', () => {
    const stream = new Stream('ch01-mission-001').started().hint(1, 5).run('whoami', 'player');
    const m = mission();
    expect(evaluateMission(m, stream.events)).toEqual(evaluateMission(m, stream.events));
  });

  it('does not mutate the events it is given', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    const snapshot = structuredClone(stream.events);
    evaluateMission(mission(), stream.events);
    expect(stream.events).toEqual(snapshot);
  });
});
