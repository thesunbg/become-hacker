import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `pnpm content:validate`, exercised against content built to break it.
 *
 * This is the only check that runs in a bare checkout, and it is what makes two of the
 * project's rules structural rather than remembered: missions are data, and a translation is
 * text only. Neither claim means anything unless the validator actually rejects content that
 * breaks them — and until now nothing proved it rejected anything.
 *
 * Each case builds a tiny content tree in a temporary directory and runs the real script
 * against it, reading the exit code the way CI does.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

let workspace: string;

beforeAll(() => {
  // The script locates content relative to itself, so the fixture needs the same shape as
  // the repo: a scripts/ directory beside content/, labs/ and the schema.
  workspace = mkdtempSync(join(tmpdir(), 'zeroroot-validate-'));
  mkdirSync(join(workspace, 'scripts'));
  copyFileSync(
    join(repoRoot, 'scripts/validate-content.mjs'),
    join(workspace, 'scripts/validate-content.mjs'),
  );
  mkdirSync(join(workspace, 'content'));
  copyFileSync(
    join(repoRoot, 'content/mission.schema.json'),
    join(workspace, 'content/mission.schema.json'),
  );
  // The real lab, so `environment.image` resolves and flag planting can be checked.
  cpSync(join(repoRoot, 'labs/linux-basic'), join(workspace, 'labs/linux-basic'), {
    recursive: true,
  });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

interface Outcome {
  readonly ok: boolean;
  readonly output: string;
}

/** Writes a content tree and runs the validator over it. */
function check(tree: {
  missions?: Record<string, unknown>;
  translations?: Record<string, Record<string, unknown>>;
}): Outcome {
  const chapters = join(workspace, 'content/chapters/01-computer');
  rmSync(join(workspace, 'content/chapters'), { recursive: true, force: true });
  rmSync(join(workspace, 'content/i18n'), { recursive: true, force: true });
  mkdirSync(chapters, { recursive: true });

  for (const [name, mission] of Object.entries(tree.missions ?? {})) {
    writeFileSync(join(chapters, name), JSON.stringify(mission, null, 2));
  }
  for (const [locale, files] of Object.entries(tree.translations ?? {})) {
    const dir = join(workspace, 'content/i18n', locale);
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), JSON.stringify(body, null, 2));
    }
  }

  // Both streams: failures go to stderr, and so do the warnings, which are part of the
  // behaviour being tested.
  const run = spawnSync('node', [join(workspace, 'scripts/validate-content.mjs')], {
    encoding: 'utf8',
  });
  return { ok: run.status === 0, output: `${run.stdout ?? ''}${run.stderr ?? ''}` };
}

/** A mission that passes every rule, as a base for breaking exactly one at a time. */
function goodMission(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'ch01-mission-001',
    chapter: 1,
    title: 'Welcome',
    difficulty: 1,
    estimatedMinutes: 10,
    story: 'A courier left a laptop at your door.',
    objective: 'Find out who you are and where you are standing.',
    environment: { type: 'terminal', image: 'linux-basic' },
    tasks: [
      {
        id: 'identify-user',
        type: 'COMMAND',
        description: 'Find out which user you are logged in as.',
        target: 'whoami',
        xp: 30,
      },
    ],
    hints: [
      { level: 1, text: 'What would you ask the machine?', xpCost: 5 },
      { level: 2, text: 'Linux commands are short, blunt English.', xpCost: 10 },
      { level: 3, text: 'Try `whoami`.', xpCost: 20 },
    ],
    knowledge: [
      {
        concept: 'Identity: the user',
        explanation: 'Every process runs as some user.',
        realWorld: 'Game -> Security -> Real world.',
      },
    ],
    skills: [{ skill: 'LINUX', amount: 5 }],
    xp: 100,
    ...overrides,
  };
}

describe('a mission that follows every rule', () => {
  it('passes', () => {
    const outcome = check({ missions: { 'mission-001.json': goodMission() } });
    expect(outcome.ok, outcome.output).toBe(true);
    expect(outcome.output).toContain('ch01-mission-001');
  });
});

describe('missions the validator must reject', () => {
  const rejects = (
    name: string,
    mission: Record<string, unknown>,
    expected: RegExp,
    file = 'mission-001.json',
  ) => {
    it(name, () => {
      const outcome = check({ missions: { [file]: mission } });
      expect(outcome.ok).toBe(false);
      expect(outcome.output).toMatch(expected);
    });
  };

  rejects('a filename that does not match the id', goodMission(), /filename should be/, 'one.json');

  rejects(
    'an id that contradicts its chapter',
    goodMission({ id: 'ch02-mission-001' }),
    /does not match chapter/,
  );

  rejects(
    'an image with no lab definition',
    goodMission({ environment: { type: 'terminal', image: 'does-not-exist' } }),
    /has no definition in labs/,
  );

  rejects(
    'hint levels that skip',
    goodMission({
      hints: [
        { level: 1, text: 'a', xpCost: 5 },
        { level: 3, text: 'b', xpCost: 10 },
      ],
    }),
    /hint levels must start at 1/,
  );

  rejects(
    'a hint that gets cheaper as it gets more specific',
    goodMission({
      hints: [
        { level: 1, text: 'a', xpCost: 20 },
        { level: 2, text: 'b', xpCost: 5 },
      ],
    }),
    /xpCost must not decrease/,
  );

  rejects(
    'two tasks with the same id',
    goodMission({
      tasks: [
        { id: 'same', type: 'COMMAND', description: 'one', target: 'whoami' },
        { id: 'same', type: 'COMMAND', description: 'two', target: 'pwd' },
      ],
    }),
    /task ids must be unique/,
  );

  rejects(
    'a mission where everything is optional',
    goodMission({
      tasks: [{ id: 'bonus', type: 'COMMAND', description: 'maybe', target: 'id', optional: true }],
    }),
    /at least one non-optional task/,
  );

  rejects(
    'a flag hunt with no flag to find',
    goodMission({
      tasks: [{ id: 'flag', type: 'FLAG_FOUND', description: 'Submit it.' }],
    }),
    /no flag/,
  );

  rejects(
    'a flag no task asks for',
    goodMission({ flag: 'ZR{unreachable}' }),
    /defines a flag no task asks the player to find/,
  );

  it('rejects a file that is not JSON at all', () => {
    const chapters = join(workspace, 'content/chapters/01-computer');
    const outcome = check({ missions: { 'mission-001.json': goodMission() } });
    expect(outcome.ok).toBe(true);
    writeFileSync(join(chapters, 'mission-002.json'), '{ not json');

    try {
      execFileSync('node', [join(workspace, 'scripts/validate-content.mjs')], { stdio: 'pipe' });
      throw new Error('expected the validator to fail');
    } catch (error) {
      expect(String((error as { stderr?: Buffer }).stderr)).toMatch(/not valid JSON/);
    }
  });
});

describe('cross-mission rules', () => {
  it('rejects two missions with the same id', () => {
    const outcome = check({
      missions: {
        'mission-001.json': goodMission(),
        'mission-002.json': goodMission({ id: 'ch01-mission-001' }),
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/filename should be|duplicate mission id/);
  });

  it('rejects a prerequisite that does not exist', () => {
    const outcome = check({
      missions: {
        'mission-001.json': goodMission({ requires: ['ch03-mission-009'] }),
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/requires unknown mission/);
  });

  it('rejects a mission that requires itself', () => {
    const outcome = check({
      missions: { 'mission-001.json': goodMission({ requires: ['ch01-mission-001'] }) },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/requires itself/);
  });

  it('rejects the same flag used twice', () => {
    const withFlag = (id: string) => ({
      ...goodMission({ id, flag: 'ZR{same_flag}' }),
      tasks: [{ id: 'flag', type: 'FLAG_FOUND', description: 'Submit it.' }],
    });
    const outcome = check({
      missions: {
        'mission-001.json': withFlag('ch01-mission-001'),
        'mission-002.json': withFlag('ch01-mission-002'),
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/duplicate flag/);
  });
});

describe('a translation is text only', () => {
  const missions = { 'mission-001.json': goodMission() };

  const translation = (overrides: Record<string, unknown> = {}) => ({
    missionId: 'ch01-mission-001',
    title: 'Chào mừng',
    story: 'Một người đưa thư để lại chiếc laptop trước cửa nhà bạn.',
    objective: 'Tìm hiểu bạn là ai và bạn đang ở đâu.',
    tasks: { 'identify-user': 'Tìm ra bạn đang đăng nhập với tài khoản nào.' },
    hints: {
      '1': 'Bạn sẽ hỏi máy tính điều gì?',
      '2': 'Lệnh Linux rất ngắn.',
      '3': 'Thử `whoami`.',
    },
    knowledge: [{ concept: 'Danh tính', explanation: 'Mọi tiến trình chạy dưới một người dùng.' }],
    ...overrides,
  });

  it('accepts a complete translation', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': translation() } },
    });
    expect(outcome.ok, outcome.output).toBe(true);
  });

  it('rejects one that names a flag', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': translation({ flag: 'ZR{dich}' }) } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/must never set/);
  });

  it('rejects one that redefines a task target — the answer itself', () => {
    const outcome = check({
      missions,
      translations: {
        vi: {
          'ch01-mission-001.json': translation({
            tasks: { 'identify-user': { description: 'Tìm ra', target: 'ai' } },
          }),
        },
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/must never set/);
  });

  it('rejects one that tries to make a hint cheaper', () => {
    const outcome = check({
      missions,
      translations: {
        vi: { 'ch01-mission-001.json': translation({ hints: { '1': { text: 'a', xpCost: 0 } } }) },
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/must never set/);
  });

  it('rejects one that tries to change the mission XP', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': translation({ xp: 9999 }) } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/must never set/);
  });

  it('allows task ids and hint levels as map keys, which is how they are addressed', () => {
    // `tasks` and `hints` are keyed by identifier by design; only their values are text.
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': translation() } },
    });
    expect(outcome.ok, outcome.output).toBe(true);
  });

  it('rejects a translation of a mission that does not exist', () => {
    const outcome = check({
      missions,
      translations: {
        vi: { 'ch09-mission-009.json': translation({ missionId: 'ch09-mission-009' }) },
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/translates unknown mission/);
  });

  it('rejects a translation with no missionId', () => {
    const body = translation();
    delete (body as { missionId?: unknown }).missionId;
    const outcome = check({ missions, translations: { vi: { 'ch01-mission-001.json': body } } });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/missing missionId/);
  });

  it('rejects a filename that does not match the mission it translates', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'welcome.json': translation() } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/filename should be/);
  });

  it('rejects a translation of a task the mission does not have', () => {
    const outcome = check({
      missions,
      translations: {
        vi: { 'ch01-mission-001.json': translation({ tasks: { 'no-such-task': 'x' } }) },
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/translates unknown task/);
  });

  it('rejects a translation of a hint level the mission does not have', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': translation({ hints: { '7': 'x' } }) } },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/translates unknown hint level/);
  });

  it('rejects knowledge that has drifted out of alignment, since it matches by position', () => {
    const outcome = check({
      missions,
      translations: {
        vi: {
          'ch01-mission-001.json': translation({
            knowledge: [{ concept: 'a' }, { concept: 'b' }],
          }),
        },
      },
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.output).toMatch(/matched by position/);
  });

  it('warns about an unfinished translation instead of failing it', () => {
    // Falling back to English is the designed behaviour; silence about it is not.
    const outcome = check({
      missions,
      translations: { vi: { 'ch01-mission-001.json': { missionId: 'ch01-mission-001' } } },
    });
    expect(outcome.ok, outcome.output).toBe(true);
    expect(outcome.output).toMatch(/not translated yet/);
  });

  it('passes over chapters.json, which translates no mission', () => {
    const outcome = check({
      missions,
      translations: { vi: { 'chapters.json': { '1': 'Máy tính' } } },
    });
    expect(outcome.ok, outcome.output).toBe(true);
  });
});
