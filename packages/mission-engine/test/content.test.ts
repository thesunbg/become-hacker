import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GameEvent, MissionDefinition } from '@zero-root/types';
import { evaluateMission } from '../src/evaluate.js';
import { nextHint } from '../src/hints.js';
import { resultForMission } from '../src/score.js';
import { resolvePath } from '../src/path.js';
import { parseCommandLine } from '../src/command.js';

/**
 * Replays the real authored missions against the real authored lab filesystem.
 *
 * Unit tests prove the engine is correct; this proves the *content* is solvable. Without it,
 * a mission could ship whose objective no command can satisfy — the engine would be right and
 * the game would still be broken.
 */

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function loadMission(file: string): MissionDefinition {
  return JSON.parse(readFileSync(join(root, 'content/chapters/01-computer', file), 'utf8'));
}

const HOME = '/home/player';

/**
 * A stand-in for the lab, backed by the files that are actually baked into the image. It
 * answers `cat` the way the container would, including the errors.
 */
class FakeLab {
  private cwd = HOME;
  private seconds = 0;
  readonly events: GameEvent[] = [];

  constructor(
    private readonly missionId: string,
    private readonly rootfs = join(root, 'labs/linux-basic/rootfs'),
  ) {}

  private stamp(): string {
    this.seconds += 1;
    return new Date(Date.parse('2026-01-01T12:00:00.000Z') + this.seconds * 1000).toISOString();
  }

  start(): this {
    this.events.push({
      sessionId: 's',
      missionId: this.missionId,
      timestamp: this.stamp(),
      type: 'MISSION_STARTED',
    });
    return this;
  }

  /** Resolves a guest path to the host file that backs it, or null if there is none. */
  private hostPath(guestPath: string): string | null {
    const candidate = join(this.rootfs, guestPath.replace(/^\//, ''));
    if (!candidate.startsWith(this.rootfs)) return null;
    return existsSync(candidate) ? candidate : null;
  }

  private simulate(line: string): string {
    const outputs: string[] = [];

    for (const parsed of parseCommandLine(line)) {
      if (parsed.program === 'cd') {
        const target = parsed.args[0] ?? '~';
        this.cwd = resolvePath(this.cwd, target, HOME);
        continue;
      }
      if (parsed.program === 'whoami') {
        outputs.push('player');
        continue;
      }
      if (parsed.program === 'pwd') {
        outputs.push(this.cwd);
        continue;
      }
      if (parsed.program === 'ls') {
        const host = this.hostPath(this.cwd);
        if (host === null) {
          outputs.push(`ls: cannot access '${this.cwd}': No such file or directory`);
          continue;
        }
        const all = parsed.shortFlags.has('a');
        const entries = readdirSync(host).filter((name) => all || !name.startsWith('.'));
        outputs.push(entries.sort().join('\n'));
        continue;
      }
      if (parsed.program === 'cat') {
        for (const arg of parsed.args) {
          const guest = resolvePath(this.cwd, arg, HOME);
          const host = this.hostPath(guest);
          if (host === null) {
            outputs.push(`cat: ${arg}: No such file or directory`);
          } else if (statSync(host).isDirectory()) {
            outputs.push(`cat: ${arg}: Is a directory`);
          } else {
            outputs.push(readFileSync(host, 'utf8'));
          }
        }
        continue;
      }
      if (parsed.program === 'find') {
        outputs.push('/home/player/.null');
        continue;
      }
      outputs.push(`${parsed.program}: command not found`);
    }

    return outputs.join('\n');
  }

  run(line: string): this {
    const output = this.simulate(line);
    this.events.push({
      sessionId: 's',
      missionId: this.missionId,
      timestamp: this.stamp(),
      type: 'COMMAND_EXECUTED',
      command: line,
      cwd: this.cwd,
      output,
    });
    return this;
  }

  /** The server decides correctness by comparing against the content, never the client. */
  submitFlag(value: string, expected: string | undefined): this {
    this.events.push({
      sessionId: 's',
      missionId: this.missionId,
      timestamp: this.stamp(),
      type: 'FLAG_SUBMITTED',
      correct: expected !== undefined && value === expected,
    });
    return this;
  }

  lastOutput(): string {
    for (let i = this.events.length - 1; i >= 0; i--) {
      const event = this.events[i];
      if (event?.type === 'COMMAND_EXECUTED') return event.output ?? '';
    }
    return '';
  }
}

describe('mission 001 — Welcome', () => {
  const m = loadMission('mission-001.json');

  it('is solvable by the intended playthrough', () => {
    const lab = new FakeLab(m.id).start().run('whoami').run('pwd').run('cat README.txt');
    const progress = evaluateMission(m, lab.events);

    expect(progress.state).toBe('COMPLETED');
    expect(progress.tasks.every((task) => task.completed)).toBe(true);
  });

  it('is not completed by poking around without reading the file', () => {
    const lab = new FakeLab(m.id).start().run('whoami').run('pwd').run('ls');
    expect(evaluateMission(m, lab.events).state).toBe('IN_PROGRESS');
  });

  it('pays the advertised XP for a clean solve', () => {
    const lab = new FakeLab(m.id).start().run('whoami').run('pwd').run('cat README.txt');
    const result = resultForMission(m, evaluateMission(m, lab.events));
    expect(result.completed).toBe(true);
    // 100 base + 100 task XP + bonuses, matching the "+100 XP" the first ten minutes promise.
    expect(result.xpAwarded).toBeGreaterThanOrEqual(100);
    expect(result.rating).toBe(5);
  });

  it('asks a question rather than giving a command as its first hint', () => {
    const hint = nextHint(m, []);
    expect(hint?.level).toBe(1);
    expect(hint?.text).toContain('?');
  });

  it('needs no flag, because nothing asks the player to find one', () => {
    expect(m.flag).toBeUndefined();
    expect(m.tasks.some((task) => task.type === 'FLAG_FOUND')).toBe(false);
  });
});

describe('mission 002 — Find the Secret', () => {
  const m = loadMission('mission-002.json');

  it('hides the secret from a default listing', () => {
    const lab = new FakeLab(m.id).start().run('ls');
    expect(lab.lastOutput()).not.toContain('.null');
  });

  it('reveals the secret once the player stops filtering', () => {
    const lab = new FakeLab(m.id).start().run('ls -la');
    expect(lab.lastOutput()).toContain('.null');
  });

  it('is solvable by the intended playthrough', () => {
    const lab = new FakeLab(m.id).start().run('ls -la').run('cat .null/first_contact');
    lab.submitFlag(m.flag!, m.flag);

    const progress = evaluateMission(m, lab.events);
    expect(progress.state).toBe('COMPLETED');
    expect(progress.flagAccepted).toBe(true);
    expect(progress.mistakes).toBe(0);
  });

  it('is solvable by navigating into the directory instead', () => {
    const lab = new FakeLab(m.id)
      .start()
      .run('ls -al')
      .run('cd .null')
      .run('cat first_contact');
    lab.submitFlag(m.flag!, m.flag);
    expect(evaluateMission(m, lab.events).state).toBe('COMPLETED');
  });

  it('plants the flag where the mission says it is', () => {
    const lab = new FakeLab(m.id).start().run('cat .null/first_contact');
    expect(lab.lastOutput()).toContain(m.flag);
  });

  it('is not completed by reading the file without submitting the flag', () => {
    const lab = new FakeLab(m.id).start().run('ls -la').run('cat .null/first_contact');
    expect(evaluateMission(m, lab.events).state).toBe('IN_PROGRESS');
  });

  it('rejects a wrong flag and counts it as a mistake, without blocking a retry', () => {
    const lab = new FakeLab(m.id).start().run('ls -la').run('cat .null/first_contact');
    lab.submitFlag('ZR{guess}', m.flag);
    expect(evaluateMission(m, lab.events).mistakes).toBe(1);

    lab.submitFlag(m.flag!, m.flag);
    const progress = evaluateMission(m, lab.events);
    expect(progress.state).toBe('COMPLETED');
    expect(progress.mistakes).toBe(1);
  });

  it('awards the bonus objective only to a player who used find', () => {
    const withoutFind = new FakeLab(m.id).start().run('ls -la').run('cat .null/first_contact');
    withoutFind.submitFlag(m.flag!, m.flag);
    const bonusOf = (events: GameEvent[]): boolean =>
      evaluateMission(m, events).tasks.find((task) => task.taskId === 'search-by-name')?.completed ??
      false;
    expect(bonusOf(withoutFind.events)).toBe(false);

    const withFind = new FakeLab(m.id)
      .start()
      .run('ls -la')
      .run('find /home/player -name first_contact')
      .run('cat .null/first_contact');
    withFind.submitFlag(m.flag!, m.flag);
    expect(bonusOf(withFind.events)).toBe(true);
  });

  it('is locked until mission 001 is done', () => {
    expect(m.requires).toEqual(['ch01-mission-001']);
  });
});

describe('every authored mission', () => {
  const missions = ['mission-001.json', 'mission-002.json'].map(loadMission);

  it('states its objective without spelling out the command that solves it', () => {
    for (const m of missions) {
      const briefing = `${m.story}\n${m.objective}`;

      // A bare program name is not evidence of a spoiler: mission 002 legitimately says
      // "find it, read it" while its bonus objective happens to target `find`. What would
      // give the answer away is an *invocation* — a program together with its flags.
      const invocations = m.tasks
        .filter((task) => task.type === 'COMMAND' && task.target !== undefined)
        .map((task) => task.target as string)
        .filter((target) => target.includes(' '));
      for (const invocation of invocations) {
        expect(briefing.toLowerCase(), `${m.id} briefing names \`${invocation}\``).not.toContain(
          invocation.toLowerCase(),
        );
      }

      // Nor should a briefing quote a command at all: that is what hints are for.
      expect(briefing, `${m.id} briefing quotes a command`).not.toMatch(/`[^`]+`/);
    }
  });

  it('keeps command syntax out of its early hints and saves it for the last', () => {
    for (const m of missions) {
      const ordered = [...m.hints].sort((a, b) => a.level - b.level);
      const quotesSyntax = (text: string): boolean => /`[^`]+`|\b\w+ +-{1,2}\w/.test(text);
      expect(quotesSyntax(ordered[0]!.text), `${m.id} hint 1 gives syntax away`).toBe(false);
      expect(
        quotesSyntax(ordered[ordered.length - 1]!.text),
        `${m.id} last hint never gives the syntax`,
      ).toBe(true);
    }
  });

  it('escalates hint cost with hint level', () => {
    for (const m of missions) {
      const costs = [...m.hints].sort((a, b) => a.level - b.level).map((hint) => hint.xpCost);
      for (let i = 1; i < costs.length; i++) {
        expect(costs[i]!).toBeGreaterThanOrEqual(costs[i - 1]!);
      }
    }
  });

  it('never leaks the flag in anything the player can read for free', () => {
    for (const m of missions) {
      if (m.flag === undefined) continue;
      expect(m.story).not.toContain(m.flag);
      expect(m.objective).not.toContain(m.flag);
      for (const task of m.tasks) expect(task.description).not.toContain(m.flag);
      for (const hint of m.hints) expect(hint.text).not.toContain(m.flag);
      for (const entry of m.knowledge) expect(entry.explanation).not.toContain(m.flag);
    }
  });

  it('carries a real-world mapping on its knowledge review', () => {
    for (const m of missions) {
      expect(m.knowledge.length).toBeGreaterThan(0);
      for (const entry of m.knowledge) {
        expect(entry.realWorld, `${m.id} / ${entry.concept}`).toBeTruthy();
      }
    }
  });
});
