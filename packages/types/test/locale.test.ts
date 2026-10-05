import { describe, expect, it } from 'vitest';
import type { MissionDefinition } from '../src/mission.js';
import { DEFAULT_LOCALE, isLocale, localiseMission, negotiateLocale } from '../src/locale.js';

const mission: MissionDefinition = {
  id: 'ch01-mission-002',
  chapter: 1,
  title: 'Find the Secret',
  difficulty: 1,
  estimatedMinutes: 12,
  story: 'The README ended mid-sentence.',
  objective: 'Something is in your home directory.',
  environment: { type: 'terminal', image: 'linux-basic' },
  tasks: [
    { id: 'list-all', type: 'COMMAND', description: 'List everything.', target: 'ls -la', xp: 30 },
    { id: 'bonus', type: 'COMMAND', description: 'Bonus.', target: 'find', optional: true, xp: 25 },
  ],
  hints: [
    { level: 1, text: 'What makes a file invisible?', xpCost: 5 },
    { level: 2, text: 'A leading dot.', xpCost: 10 },
  ],
  flag: 'ZR{h1dd3n_1n_pl41n_s1ght}',
  knowledge: [{ concept: 'Hidden files', explanation: 'A convention.', realWorld: 'Leaked .env.' }],
  skills: [{ skill: 'LINUX', amount: 6 }],
  xp: 150,
  requires: ['ch01-mission-001'],
};

describe('isLocale', () => {
  it('accepts the supported languages', () => {
    expect(isLocale('en')).toBe(true);
    expect(isLocale('vi')).toBe(true);
  });

  it('rejects anything else', () => {
    for (const value of ['fr', 'VI', '', null, undefined, 42, {}]) {
      expect(isLocale(value)).toBe(false);
    }
  });
});

describe('negotiateLocale', () => {
  it('picks a supported language from the header', () => {
    expect(negotiateLocale('vi')).toBe('vi');
  });

  it('falls back from a regional tag to its base language', () => {
    expect(negotiateLocale('vi-VN')).toBe('vi');
  });

  it('honours quality values rather than order', () => {
    expect(negotiateLocale('vi;q=0.8, en;q=0.9')).toBe('en');
    expect(negotiateLocale('en;q=0.2, vi;q=0.9')).toBe('vi');
  });

  it('skips languages it does not have', () => {
    expect(negotiateLocale('fr-FR, de;q=0.9, vi;q=0.5')).toBe('vi');
  });

  it('returns null when nothing matches, so the caller decides the default', () => {
    expect(negotiateLocale('fr, de')).toBeNull();
    expect(negotiateLocale('')).toBeNull();
    expect(negotiateLocale(undefined)).toBeNull();
  });

  it('ignores a language the client explicitly refused', () => {
    expect(negotiateLocale('vi;q=0')).toBeNull();
  });
});

describe('localiseMission — a translation cannot change the answer', () => {
  // The property that matters: whatever a translation file contains, the things that decide
  // whether a player is right come from the canonical mission.
  const hostile = {
    missionId: 'ch01-mission-002',
    title: 'Tìm bí mật',
    tasks: { 'list-all': 'Liệt kê mọi thứ.' },
    hints: { '1': 'Điều gì làm một tệp vô hình?' },
    // None of the following are read, and the type does not allow them either.
    flag: 'ZR{forged}',
    xp: 999_999,
    requires: [],
  } as never;

  const localised = localiseMission(mission, hostile);

  it('keeps the flag', () => {
    expect(localised.flag).toBe('ZR{h1dd3n_1n_pl41n_s1ght}');
  });

  it('keeps every task target', () => {
    expect(localised.tasks.map((task) => task.target)).toEqual(['ls -la', 'find']);
  });

  it('keeps task ids, types, optionality and XP', () => {
    expect(localised.tasks[0]).toEqual({
      id: 'list-all',
      type: 'COMMAND',
      description: 'Liệt kê mọi thứ.',
      target: 'ls -la',
      xp: 30,
    });
    expect(localised.tasks[1]?.optional).toBe(true);
  });

  it('keeps hint levels and costs, so a translation cannot make a hint cheaper', () => {
    expect(localised.hints).toEqual([
      { level: 1, text: 'Điều gì làm một tệp vô hình?', xpCost: 5 },
      { level: 2, text: 'A leading dot.', xpCost: 10 },
    ]);
  });

  it('keeps mission XP and prerequisites', () => {
    expect(localised.xp).toBe(150);
    expect(localised.requires).toEqual(['ch01-mission-001']);
  });

  it('translates the text it is given', () => {
    expect(localised.title).toBe('Tìm bí mật');
  });
});

describe('localiseMission — partial translations', () => {
  it('returns the mission untouched when there is no translation', () => {
    expect(localiseMission(mission, undefined)).toBe(mission);
  });

  it('falls back field by field rather than showing blanks', () => {
    const partial = localiseMission(mission, {
      missionId: mission.id,
      title: 'Tìm bí mật',
    });
    expect(partial.title).toBe('Tìm bí mật');
    expect(partial.story).toBe('The README ended mid-sentence.');
    expect(partial.tasks[0]?.description).toBe('List everything.');
    expect(partial.hints[0]?.text).toBe('What makes a file invisible?');
  });

  it('leaves an untranslated task alone while translating its sibling', () => {
    const partial = localiseMission(mission, {
      missionId: mission.id,
      tasks: { bonus: 'Thưởng.' },
    });
    expect(partial.tasks[0]?.description).toBe('List everything.');
    expect(partial.tasks[1]?.description).toBe('Thưởng.');
  });

  it('translates knowledge by position, keeping untranslated parts', () => {
    const partial = localiseMission(mission, {
      missionId: mission.id,
      knowledge: [{ concept: 'Tệp ẩn' }],
    });
    expect(partial.knowledge[0]).toEqual({
      concept: 'Tệp ẩn',
      explanation: 'A convention.',
      realWorld: 'Leaked .env.',
    });
  });

  it('ignores a knowledge entry beyond what the mission has', () => {
    const partial = localiseMission(mission, {
      missionId: mission.id,
      knowledge: [{ concept: 'Tệp ẩn' }, { concept: 'Thừa' }],
    });
    expect(partial.knowledge).toHaveLength(1);
  });
});

describe('DEFAULT_LOCALE', () => {
  it('is English, the language the canonical content is authored in', () => {
    expect(DEFAULT_LOCALE).toBe('en');
  });
});
