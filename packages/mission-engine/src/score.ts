import type {
  MissionDefinition,
  MissionProgress,
  MissionResult,
  ScoreBreakdown,
} from '@zero-root/types';

/**
 * Scoring and rating.
 *
 * Two rules from the spec shape every number here:
 *
 *   1. "Do not make XP punishment too severe. The purpose is learning."
 *   2. Failure is a designed step in the learning arc, not a transgression.
 *
 * So penalties are bounded, a completed mission always keeps a meaningful share of its XP,
 * and the things that earn the most are the behaviours we actually want: solving it yourself,
 * solving it efficiently, and looking past the required objectives.
 */

export const SCORING = {
  /** Bonus as a fraction of the mission's base XP. */
  firstAttemptBonus: 0.1,
  noHintBonus: 0.15,
  efficiencyBonus: 0.1,
  /** XP lost per wrong assertion, and the cap on that loss. */
  mistakeCost: 5,
  mistakePenaltyCap: 0.1,
  /** A completed mission never pays less than this share of its base XP. */
  xpFloor: 0.25,
  /** Elapsed time up to estimate x this still counts as efficient. */
  efficiencyGrace: 1.25,
  /** Mistakes at which the mistake component of the score reaches zero. */
  mistakeScoreScale: 5,
  weights: {
    completion: 0.45,
    optional: 0.15,
    hints: 0.2,
    mistakes: 0.1,
    time: 0.1,
  },
  stars: [
    { min: 900, rating: 5 },
    { min: 750, rating: 4 },
    { min: 600, rating: 3 },
    { min: 450, rating: 2 },
    { min: 1, rating: 1 },
  ],
} as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function ratingFromScore(score: number): number {
  for (const tier of SCORING.stars) {
    if (score >= tier.min) return tier.rating;
  }
  return 0;
}

/**
 * The 0–1000 score behind the star rating.
 *
 * Deliberately *not* XP: XP measures how much you did, score measures how well you did it.
 * Ranking on score rather than XP is what stops players grinding easy missions
 * (docs/02-gameplay.md).
 *
 * A score is a property of a *finished* mission, so an incomplete one scores zero. Without
 * that gate the quality components unrelated to progress — no hints used, no mistakes made,
 * no time elapsed — would hand a mission nobody had even started a respectable score.
 */
export function scoreMission(mission: MissionDefinition, progress: MissionProgress): number {
  const { weights } = SCORING;

  const completion =
    progress.requiredTaskCount === 0
      ? 0
      : progress.completedRequiredCount / progress.requiredTaskCount;
  if (completion < 1) return 0;

  const optionalTasks = progress.tasks.filter((task) => task.optional);
  const optionalDone = optionalTasks.filter((task) => task.completed).length;
  const hasOptional = optionalTasks.length > 0;
  const optional = hasOptional ? optionalDone / optionalTasks.length : 0;

  // With nothing optional to find, that weight belongs to the work the player actually did.
  const completionWeight = hasOptional ? weights.completion : weights.completion + weights.optional;

  const hintBudget = Math.max(1, mission.hints.reduce((sum, hint) => sum + hint.xpCost, 0));
  const hintSpend = progress.hintsUsed.reduce((sum, level) => {
    const hint = mission.hints.find((candidate) => candidate.level === level);
    return sum + (hint?.xpCost ?? 0);
  }, 0);
  const hintFactor = clamp01(1 - hintSpend / hintBudget);

  const mistakeFactor = clamp01(1 - progress.mistakes / SCORING.mistakeScoreScale);

  const estimate = mission.estimatedMinutes * 60 * SCORING.efficiencyGrace;
  const timeFactor =
    progress.elapsedSeconds <= 0 ? 1 : clamp01(estimate / Math.max(progress.elapsedSeconds, 1));

  const quality =
    completionWeight * completion +
    (hasOptional ? weights.optional * optional : 0) +
    weights.hints * hintFactor +
    weights.mistakes * mistakeFactor +
    weights.time * timeFactor;

  return Math.round(1000 * clamp01(quality));
}

export function xpForMission(
  mission: MissionDefinition,
  progress: MissionProgress,
): ScoreBreakdown & { total: number } {
  const base = mission.xp;

  const taskXp = progress.tasks
    .filter((task) => task.completed)
    .reduce((sum, task) => sum + task.xp, 0);

  let bonusXp = 0;
  if (progress.attempts <= 1) bonusXp += base * SCORING.firstAttemptBonus;
  if (progress.hintsUsed.length === 0) bonusXp += base * SCORING.noHintBonus;
  if (
    progress.elapsedSeconds > 0 &&
    progress.elapsedSeconds <= mission.estimatedMinutes * 60 * SCORING.efficiencyGrace
  ) {
    bonusXp += base * SCORING.efficiencyBonus;
  }
  bonusXp = Math.round(bonusXp);

  const hintPenalty = progress.hintsUsed.reduce((sum, level) => {
    const hint = mission.hints.find((candidate) => candidate.level === level);
    return sum + (hint?.xpCost ?? 0);
  }, 0);

  const mistakePenalty = Math.min(
    progress.mistakes * SCORING.mistakeCost,
    Math.round(base * SCORING.mistakePenaltyCap),
  );

  const raw = base + taskXp + bonusXp - hintPenalty - mistakePenalty;
  const floor = Math.ceil(base * SCORING.xpFloor);
  const total = Math.max(raw, floor);

  return {
    missionXp: base,
    taskXp,
    bonusXp,
    hintPenalty,
    mistakePenalty,
    floorApplied: raw < floor,
    total,
  };
}

/**
 * The mission result the player is shown, and the only source of the XP that gets written to
 * the ledger. Returns `completed: false` for a mission still in progress, with XP zero —
 * partial credit is awarded on completion, not continuously.
 */
export function resultForMission(
  mission: MissionDefinition,
  progress: MissionProgress,
): MissionResult {
  const completed = progress.state === 'COMPLETED';
  const score = scoreMission(mission, progress);
  const breakdown = xpForMission(mission, progress);

  return {
    missionId: mission.id,
    completed,
    score: completed ? score : 0,
    rating: completed ? ratingFromScore(score) : 0,
    xpAwarded: completed ? breakdown.total : 0,
    breakdown: {
      missionXp: breakdown.missionXp,
      taskXp: breakdown.taskXp,
      bonusXp: breakdown.bonusXp,
      hintPenalty: breakdown.hintPenalty,
      mistakePenalty: breakdown.mistakePenalty,
      floorApplied: breakdown.floorApplied,
    },
    skills: completed ? mission.skills : [],
    elapsedSeconds: progress.elapsedSeconds,
    hintsUsed: progress.hintsUsed.length,
    mistakes: progress.mistakes,
  };
}
