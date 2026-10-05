import { describe, expect, it } from 'vitest';
import { evaluateMission } from '../src/evaluate.js';
import {
  SCORING,
  ratingFromScore,
  resultForMission,
  scoreMission,
  xpForMission,
} from '../src/score.js';
import { Stream, mission } from './helpers.js';

const perfect = () => new Stream('ch01-mission-001').started().run('whoami', 'player');

describe('ratingFromScore', () => {
  it('awards five stars at the top tier', () => {
    expect(ratingFromScore(950)).toBe(5);
  });

  it('awards no stars for a zero score', () => {
    expect(ratingFromScore(0)).toBe(0);
  });

  it('never decreases as the score rises', () => {
    let previous = 0;
    for (let score = 0; score <= 1000; score += 10) {
      const rating = ratingFromScore(score);
      expect(rating).toBeGreaterThanOrEqual(previous);
      previous = rating;
    }
  });
});

describe('scoreMission', () => {
  it('gives a clean solve a top score', () => {
    const m = mission();
    const progress = evaluateMission(m, perfect().events);
    expect(scoreMission(m, progress)).toBeGreaterThanOrEqual(900);
  });

  it('scores an unstarted mission at zero', () => {
    const m = mission();
    expect(scoreMission(m, evaluateMission(m, []))).toBe(0);
  });

  it('scores lower when hints were used', () => {
    const m = mission();
    const clean = scoreMission(m, evaluateMission(m, perfect().events));
    const hinted = new Stream('ch01-mission-001')
      .started()
      .hint(1, 5)
      .hint(2, 10)
      .hint(3, 20)
      .run('whoami', 'player');
    expect(scoreMission(m, evaluateMission(m, hinted.events))).toBeLessThan(clean);
  });

  it('scores lower after wrong answers', () => {
    const m = mission();
    const clean = scoreMission(m, evaluateMission(m, perfect().events));
    const sloppy = new Stream('ch01-mission-001')
      .started()
      .flag(false)
      .flag(false)
      .run('whoami', 'player');
    expect(scoreMission(m, evaluateMission(m, sloppy.events))).toBeLessThan(clean);
  });

  it('scores lower when the mission took far longer than estimated', () => {
    const m = mission();
    const clean = scoreMission(m, evaluateMission(m, perfect().events));
    const slow = new Stream('ch01-mission-001').started().wait(3600).run('whoami', 'player');
    expect(scoreMission(m, evaluateMission(m, slow.events))).toBeLessThan(clean);
  });

  it('stays within 0..1000 across a wide range of play', () => {
    const m = mission({
      tasks: [
        { id: 'req', type: 'COMMAND', description: 'r', target: 'whoami', xp: 10 },
        { id: 'opt', type: 'COMMAND', description: 'o', target: 'find', optional: true, xp: 25 },
      ],
    });
    for (const hints of [0, 1, 2, 3]) {
      for (const mistakes of [0, 3, 10]) {
        for (const seconds of [0, 60, 7200]) {
          const stream = new Stream('ch01-mission-001').started();
          for (let level = 1; level <= hints; level++) stream.hint(level, level * 5);
          for (let i = 0; i < mistakes; i++) stream.flag(false);
          stream.wait(seconds).run('whoami', 'player');
          const score = scoreMission(m, evaluateMission(m, stream.events));
          expect(score).toBeGreaterThanOrEqual(0);
          expect(score).toBeLessThanOrEqual(1000);
        }
      }
    }
  });

  it('rewards finding the optional objective', () => {
    const m = mission({
      tasks: [
        { id: 'req', type: 'COMMAND', description: 'r', target: 'whoami', xp: 10 },
        { id: 'opt', type: 'COMMAND', description: 'o', target: 'find', optional: true, xp: 25 },
      ],
    });
    const without = scoreMission(m, evaluateMission(m, perfect().events));
    const with_ = new Stream('ch01-mission-001')
      .started()
      .run('whoami', 'player')
      .run('find /', 'x');
    expect(scoreMission(m, evaluateMission(m, with_.events))).toBeGreaterThan(without);
  });
});

describe('xpForMission', () => {
  it('pays base XP plus task XP plus bonuses on a clean first solve', () => {
    const m = mission();
    const breakdown = xpForMission(m, evaluateMission(m, perfect().events));
    expect(breakdown.missionXp).toBe(100);
    expect(breakdown.taskXp).toBe(10);
    // first attempt 10 + no hints 15 + efficient 10
    expect(breakdown.bonusXp).toBe(35);
    expect(breakdown.hintPenalty).toBe(0);
    expect(breakdown.total).toBe(145);
  });

  it('charges the published cost of each hint used', () => {
    const m = mission();
    const stream = new Stream('ch01-mission-001')
      .started()
      .hint(1, 5)
      .hint(2, 10)
      .run('whoami', 'player');
    const breakdown = xpForMission(m, evaluateMission(m, stream.events));
    expect(breakdown.hintPenalty).toBe(15);
  });

  it('caps the mistake penalty, however many wrong guesses were made', () => {
    const m = mission();
    const stream = new Stream('ch01-mission-001').started();
    for (let i = 0; i < 100; i++) stream.flag(false);
    stream.run('whoami', 'player');
    const breakdown = xpForMission(m, evaluateMission(m, stream.events));
    expect(breakdown.mistakePenalty).toBe(Math.round(100 * SCORING.mistakePenaltyCap));
  });

  it('never pays less than the floor, because the purpose is learning', () => {
    const m = mission({
      hints: [
        { level: 1, text: 'a', xpCost: 500 },
        { level: 2, text: 'b', xpCost: 500 },
        { level: 3, text: 'c', xpCost: 500 },
      ],
    });
    const stream = new Stream('ch01-mission-001').started().hint(1, 500).hint(2, 500).hint(3, 500);
    for (let i = 0; i < 50; i++) stream.flag(false);
    stream.run('whoami', 'player');
    const breakdown = xpForMission(m, evaluateMission(m, stream.events));
    expect(breakdown.floorApplied).toBe(true);
    expect(breakdown.total).toBe(Math.ceil(100 * SCORING.xpFloor));
    expect(breakdown.total).toBeGreaterThan(0);
  });

  it('withholds the first-attempt bonus on a retry', () => {
    const m = mission();
    const stream = new Stream('ch01-mission-001')
      .started()
      .abandoned()
      .started()
      .run('whoami', 'player');
    const breakdown = xpForMission(m, evaluateMission(m, stream.events));
    expect(breakdown.bonusXp).toBe(25); // no-hint 15 + efficient 10
  });
});

describe('resultForMission', () => {
  it('awards nothing while the mission is unfinished', () => {
    const m = mission();
    const stream = new Stream('ch01-mission-001').started().run('ls', 'a');
    const result = resultForMission(m, evaluateMission(m, stream.events));
    expect(result.completed).toBe(false);
    expect(result.xpAwarded).toBe(0);
    expect(result.score).toBe(0);
    expect(result.rating).toBe(0);
    expect(result.skills).toEqual([]);
  });

  it('awards XP, a rating and skill gains on completion', () => {
    const m = mission();
    const result = resultForMission(m, evaluateMission(m, perfect().events));
    expect(result.completed).toBe(true);
    expect(result.xpAwarded).toBe(145);
    expect(result.rating).toBe(5);
    expect(result.skills).toEqual([{ skill: 'LINUX', amount: 5 }]);
  });

  it('reports the hint and mistake counts the player is shown', () => {
    const m = mission();
    const stream = new Stream('ch01-mission-001')
      .started()
      .hint(1, 5)
      .flag(false)
      .run('whoami', 'player');
    const result = resultForMission(m, evaluateMission(m, stream.events));
    expect(result.hintsUsed).toBe(1);
    expect(result.mistakes).toBe(1);
  });
});
