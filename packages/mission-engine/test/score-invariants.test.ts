import { describe, expect, it } from 'vitest';
import type { MissionProgress } from '@zero-root/types';
import {
  SCORING,
  ratingFromScore,
  resultForMission,
  scoreMission,
  xpForMission,
} from '../src/score.js';
import { mission } from './helpers.js';

/**
 * The scoring rules as properties rather than examples.
 *
 * score.test.ts checks what the numbers are. This checks what they can never be — that no
 * combination of hints, mistakes, time and optional work can produce a score outside the
 * range, break the ordering the design promises, or pay less XP than the floor. Those are
 * the claims the design documents make, and an example test can only sample them.
 */

const completed = (over: Partial<MissionProgress> = {}): MissionProgress => ({
  missionId: 'ch01-mission-001',
  state: 'COMPLETED',
  tasks: [{ taskId: 't1', completed: true, optional: false, xp: 10 }],
  requiredTaskCount: 1,
  completedRequiredCount: 1,
  flagAccepted: false,
  hintsUsed: [],
  mistakes: 0,
  attempts: 1,
  elapsedSeconds: 120,
  ...over,
});

/** Every combination worth sampling: hints bought, mistakes made, time taken, attempts. */
const HINT_SETS = [[], [1], [1, 2], [1, 2, 3]];
const MISTAKE_COUNTS = [0, 1, 3, 5, 12, 100];
const ELAPSED = [0, 1, 120, 600, 750, 751, 7200, 86_400];
const ATTEMPTS = [1, 2, 7];

function* everyCompletedProgress(): Generator<MissionProgress> {
  for (const hintsUsed of HINT_SETS) {
    for (const mistakes of MISTAKE_COUNTS) {
      for (const elapsedSeconds of ELAPSED) {
        for (const attempts of ATTEMPTS) {
          yield completed({ hintsUsed, mistakes, elapsedSeconds, attempts });
        }
      }
    }
  }
}

describe('the weights describe a whole', () => {
  it('sums to one, so a flawless mission can reach the top of the range', () => {
    const total = Object.values(SCORING.weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it('weights completion above everything else, because doing the work is the point', () => {
    const { completion, ...rest } = SCORING.weights;
    for (const weight of Object.values(rest)) expect(completion).toBeGreaterThan(weight);
  });

  it('awards a flawless solve the full range', () => {
    const flawless = completed({ hintsUsed: [], mistakes: 0, elapsedSeconds: 1 });
    expect(scoreMission(mission(), flawless)).toBe(1000);
  });
});

describe('score stays inside its range', () => {
  it('never leaves 0–1000, for any history', () => {
    for (const progress of everyCompletedProgress()) {
      const score = scoreMission(mission(), progress);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1000);
      expect(Number.isInteger(score)).toBe(true);
    }
  });

  it('never leaves the range for a mission with no hints to buy', () => {
    const noHints = mission({ hints: [] });
    for (const progress of everyCompletedProgress()) {
      const score = scoreMission(noHints, progress);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1000);
    }
  });

  it('survives an absurd estimate without producing NaN', () => {
    for (const estimatedMinutes of [0, 0.5, 1e9]) {
      const score = scoreMission(mission({ estimatedMinutes }), completed());
      expect(Number.isFinite(score)).toBe(true);
    }
  });
});

describe('score moves the way the design says it does', () => {
  it('never rises when another hint is bought', () => {
    let previous = Infinity;
    for (const hintsUsed of HINT_SETS) {
      const score = scoreMission(mission(), completed({ hintsUsed }));
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it('never rises when another mistake is made', () => {
    let previous = Infinity;
    for (const mistakes of MISTAKE_COUNTS) {
      const score = scoreMission(mission(), completed({ mistakes }));
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it('never rises when the mission takes longer', () => {
    let previous = Infinity;
    for (const elapsedSeconds of ELAPSED.filter((seconds) => seconds > 0)) {
      const score = scoreMission(mission(), completed({ elapsedSeconds }));
      expect(score).toBeLessThanOrEqual(previous);
      previous = score;
    }
  });

  it('never falls when an optional objective is also found', () => {
    const withBonus = mission({
      tasks: [
        { id: 't1', type: 'COMMAND', description: 'required', target: 'whoami' },
        { id: 't2', type: 'COMMAND', description: 'bonus', target: 'id', optional: true },
      ],
    });
    const base = completed({
      tasks: [
        { taskId: 't1', completed: true, optional: false, xp: 10 },
        { taskId: 't2', completed: false, optional: true, xp: 5 },
      ],
    });
    const extra = completed({
      tasks: [
        { taskId: 't1', completed: true, optional: false, xp: 10 },
        { taskId: 't2', completed: true, optional: true, xp: 5 },
      ],
    });
    expect(scoreMission(withBonus, extra)).toBeGreaterThan(scoreMission(withBonus, base));
  });

  it('stops punishing mistakes once the component is exhausted, rather than going negative', () => {
    const many = scoreMission(mission(), completed({ mistakes: SCORING.mistakeScoreScale }));
    const absurd = scoreMission(mission(), completed({ mistakes: 10_000 }));
    expect(absurd).toBe(many);
  });

  it('scores an unfinished mission zero, whatever else it looks like', () => {
    const almost = completed({
      state: 'IN_PROGRESS',
      requiredTaskCount: 2,
      completedRequiredCount: 1,
    });
    expect(scoreMission(mission(), almost)).toBe(0);
  });

  it('scores a mission with nothing required zero, not full marks', () => {
    const nothing = completed({ requiredTaskCount: 0, completedRequiredCount: 0, tasks: [] });
    expect(scoreMission(mission(), nothing)).toBe(0);
  });
});

describe('rating follows score', () => {
  it('is ordered, so a higher score never earns fewer stars', () => {
    let previous = 0;
    for (let score = 0; score <= 1000; score += 1) {
      const rating = ratingFromScore(score);
      expect(rating).toBeGreaterThanOrEqual(previous);
      previous = rating;
    }
  });

  it('stays between no stars and five', () => {
    for (let score = -100; score <= 1100; score += 7) {
      const rating = ratingFromScore(score);
      expect(rating).toBeGreaterThanOrEqual(0);
      expect(rating).toBeLessThanOrEqual(5);
    }
  });

  it('gives a score of zero no stars at all', () => {
    expect(ratingFromScore(0)).toBe(0);
  });

  it('declares its tiers in descending order, which is what the lookup assumes', () => {
    const mins = SCORING.stars.map((tier) => tier.min);
    expect([...mins].sort((a, b) => b - a)).toEqual(mins);
  });
});

describe('XP is bounded above and below', () => {
  it('never pays less than the floor for a completed mission', () => {
    const floor = Math.ceil(mission().xp * SCORING.xpFloor);
    for (const progress of everyCompletedProgress()) {
      expect(xpForMission(mission(), progress).total).toBeGreaterThanOrEqual(floor);
    }
  });

  it('never pays more than base plus task XP plus every bonus', () => {
    const subject = mission();
    const ceiling =
      subject.xp +
      10 +
      Math.round(
        subject.xp * (SCORING.firstAttemptBonus + SCORING.noHintBonus + SCORING.efficiencyBonus),
      );
    for (const progress of everyCompletedProgress()) {
      expect(xpForMission(subject, progress).total).toBeLessThanOrEqual(ceiling);
    }
  });

  it('caps the mistake penalty however many wrong answers were submitted', () => {
    const cap = Math.round(mission().xp * SCORING.mistakePenaltyCap);
    for (const mistakes of MISTAKE_COUNTS) {
      expect(xpForMission(mission(), completed({ mistakes })).mistakePenalty).toBeLessThanOrEqual(
        cap,
      );
    }
  });

  it('never needs the floor at the hint costs the content actually uses', () => {
    // "Do not make XP punishment too severe" is a design rule, and this is what it means in
    // arithmetic: with authored hint costs, no history a player can produce reaches the floor.
    for (const progress of everyCompletedProgress()) {
      expect(xpForMission(mission(), progress).floorApplied).toBe(false);
    }
  });

  it('applies the floor, and says so, when the hints cost more than the mission pays', () => {
    const expensive = mission({
      hints: [
        { level: 1, text: 'think', xpCost: 60 },
        { level: 2, text: 'concept', xpCost: 70 },
        { level: 3, text: 'syntax', xpCost: 80 },
      ],
    });
    const ruined = completed({ hintsUsed: [1, 2, 3], mistakes: 20, elapsedSeconds: 86_400 });
    const breakdown = xpForMission(expensive, ruined);
    expect(breakdown.floorApplied).toBe(true);
    expect(breakdown.total).toBe(Math.ceil(expensive.xp * SCORING.xpFloor));
    expect(breakdown.total).toBeGreaterThan(0);
  });

  it('charges a hint exactly what it advertised, and only once', () => {
    const subject = mission();
    const twice = completed({ hintsUsed: [1, 1] as unknown as number[] });
    const once = completed({ hintsUsed: [1] });
    // The engine deduplicates levels, so a duplicated record cannot double-charge.
    expect(xpForMission(subject, twice).hintPenalty).toBe(
      xpForMission(subject, once).hintPenalty * 2,
    );
    expect(xpForMission(subject, once).hintPenalty).toBe(5);
  });

  it('ignores a hint level the mission does not have', () => {
    expect(xpForMission(mission(), completed({ hintsUsed: [99] })).hintPenalty).toBe(0);
  });

  it('is integral, because XP is a count', () => {
    for (const progress of everyCompletedProgress()) {
      const breakdown = xpForMission(mission(), progress);
      for (const value of [
        breakdown.total,
        breakdown.bonusXp,
        breakdown.hintPenalty,
        breakdown.mistakePenalty,
        breakdown.taskXp,
      ]) {
        expect(Number.isInteger(value)).toBe(true);
      }
    }
  });
});

describe('the result handed to the player', () => {
  it('awards nothing at all until the mission is complete', () => {
    for (const state of ['AVAILABLE', 'STARTED', 'IN_PROGRESS', 'FAILED', 'ABANDONED'] as const) {
      const result = resultForMission(mission(), completed({ state }));
      expect(result.completed).toBe(false);
      expect(result.xpAwarded).toBe(0);
      expect(result.score).toBe(0);
      expect(result.rating).toBe(0);
      expect(result.skills).toEqual([]);
    }
  });

  it('awards the skills only on completion, so progress cannot be farmed', () => {
    const result = resultForMission(mission(), completed());
    expect(result.skills).toEqual([{ skill: 'LINUX', amount: 5 }]);
  });

  it('is deterministic — the same history always pays the same', () => {
    for (const progress of everyCompletedProgress()) {
      expect(resultForMission(mission(), progress)).toEqual(resultForMission(mission(), progress));
    }
  });

  it('reports the history it scored, so the panel can explain the number', () => {
    const progress = completed({ hintsUsed: [1, 2], mistakes: 3, elapsedSeconds: 240 });
    const result = resultForMission(mission(), progress);
    expect(result.hintsUsed).toBe(2);
    expect(result.mistakes).toBe(3);
    expect(result.elapsedSeconds).toBe(240);
  });
});
