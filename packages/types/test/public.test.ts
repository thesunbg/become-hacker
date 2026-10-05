import { describe, expect, it } from 'vitest';
import type { MissionDefinition } from '../src/mission.js';
import { toPublicMission, withoutKnowledge } from '../src/public.js';

/**
 * Rule 4 of CLAUDE.md: a flag must never reach the client. The type system catches a DTO that
 * declares one; these tests catch a mapper that smuggles one through at runtime.
 */

const full: MissionDefinition = {
  id: 'ch01-mission-002',
  chapter: 1,
  title: 'Find the Secret',
  difficulty: 1,
  estimatedMinutes: 12,
  story: 'story',
  objective: 'objective',
  environment: { type: 'terminal', image: 'linux-basic' },
  tasks: [
    {
      id: 'find-hidden',
      type: 'FILE_FOUND',
      description: 'read it',
      target: '/home/player/.null/first_contact',
      xp: 50,
    },
    { id: 'bonus', type: 'COMMAND', description: 'bonus', target: 'find', optional: true, xp: 25 },
  ],
  hints: [
    { level: 1, text: 'a question', xpCost: 5 },
    { level: 2, text: 'the concept', xpCost: 10 },
    { level: 3, text: 'the syntax: ls -la', xpCost: 20 },
  ],
  flag: 'ZR{h1dd3n_1n_pl41n_s1ght}',
  knowledge: [{ concept: 'c', explanation: 'e', realWorld: 'r' }],
  skills: [{ skill: 'LINUX', amount: 6 }],
  xp: 150,
  requires: ['ch01-mission-001'],
};

describe('toPublicMission', () => {
  const published = toPublicMission(full, 'IN_PROGRESS');

  it('does not carry the flag', () => {
    expect('flag' in published).toBe(false);
  });

  it('does not carry the flag anywhere in its serialised form', () => {
    expect(JSON.stringify(published)).not.toContain('h1dd3n');
  });

  it('withholds task targets, which are usually the answer', () => {
    expect(JSON.stringify(published)).not.toContain('/home/player/.null/first_contact');
    for (const task of published.tasks) expect('target' in task).toBe(false);
  });

  it('withholds the text of hints the player has not paid for', () => {
    expect(JSON.stringify(published)).not.toContain('ls -la');
    expect(published.hints.every((hint) => !hint.revealed)).toBe(true);
  });

  it('publishes hint cost and level, so the player can decide whether to buy', () => {
    expect(published.hints).toEqual([
      { level: 1, xpCost: 5, revealed: false },
      { level: 2, xpCost: 10, revealed: false },
      { level: 3, xpCost: 20, revealed: false },
    ]);
  });

  it('includes the text of a hint the player has unlocked', () => {
    const withHint = toPublicMission(full, 'IN_PROGRESS', [1]);
    expect(withHint.hints[0]).toEqual({ level: 1, xpCost: 5, revealed: true });
  });

  it('keeps the briefing, the checklist and the declared state', () => {
    expect(published.story).toBe('story');
    expect(published.tasks.map((task) => task.description)).toEqual(['read it', 'bonus']);
    expect(published.state).toBe('IN_PROGRESS');
  });

  it('normalises the optional flag and task XP for the client', () => {
    expect(published.tasks[0]).toEqual({
      id: 'find-hidden',
      type: 'FILE_FOUND',
      description: 'read it',
      optional: false,
      xp: 50,
    });
    expect(published.tasks[1]?.optional).toBe(true);
  });

  it('defaults requires to an empty list when the mission declares none', () => {
    const { requires: _omitted, ...withoutRequires } = full;
    expect(toPublicMission(withoutRequires, 'AVAILABLE').requires).toEqual([]);
  });
});

describe('withoutKnowledge', () => {
  it('strips the review, which is earned by completing the mission', () => {
    const published = toPublicMission(full, 'AVAILABLE');
    expect(withoutKnowledge(published).knowledge).toEqual([]);
  });

  it('leaves everything else intact', () => {
    const published = toPublicMission(full, 'AVAILABLE');
    expect(withoutKnowledge(published).title).toBe(published.title);
  });
});
