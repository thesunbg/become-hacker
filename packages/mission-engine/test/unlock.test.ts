import { describe, expect, it } from 'vitest';
import { isUnlocked, missionState, sortMissions } from '../src/unlock.js';
import { mission } from './helpers.js';

describe('isUnlocked', () => {
  it('unlocks a mission with no prerequisites', () => {
    expect(isUnlocked(mission(), [])).toBe(true);
  });

  it('keeps a mission locked until its prerequisite is completed', () => {
    const m = mission({ id: 'ch01-mission-002', requires: ['ch01-mission-001'] });
    expect(isUnlocked(m, [])).toBe(false);
    expect(isUnlocked(m, ['ch01-mission-001'])).toBe(true);
  });

  it('requires every prerequisite, not just one', () => {
    const m = mission({ requires: ['a', 'b'] });
    expect(isUnlocked(m, ['a'])).toBe(false);
    expect(isUnlocked(m, ['a', 'b'])).toBe(true);
  });
});

describe('missionState', () => {
  it('reports LOCKED ahead of any recorded progress', () => {
    const m = mission({ requires: ['ch01-mission-001'] });
    expect(missionState(m, [])).toBe('LOCKED');
  });

  it('reports AVAILABLE for an unlocked mission never started', () => {
    expect(missionState(mission(), [])).toBe('AVAILABLE');
  });

  it('passes through recorded progress for an unlocked mission', () => {
    expect(missionState(mission(), [], 'IN_PROGRESS')).toBe('IN_PROGRESS');
  });

  it('keeps a completed mission completed even if its prerequisites changed later', () => {
    const m = mission({ requires: ['never-completed'] });
    expect(missionState(m, [], 'COMPLETED')).toBe('COMPLETED');
  });
});

describe('sortMissions', () => {
  it('orders by chapter, then by id', () => {
    const ordered = sortMissions([
      mission({ id: 'ch02-mission-011', chapter: 2 }),
      mission({ id: 'ch01-mission-002', chapter: 1 }),
      mission({ id: 'ch01-mission-001', chapter: 1 }),
    ]);
    expect(ordered.map((m) => m.id)).toEqual([
      'ch01-mission-001',
      'ch01-mission-002',
      'ch02-mission-011',
    ]);
  });
});
