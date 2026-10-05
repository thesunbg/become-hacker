import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { MissionProgress, MissionResult, MissionState } from '@zero-root/types';
import {
  evaluateMission,
  isUnlocked,
  missionState,
  resultForMission,
} from '@zero-root/mission-engine';
import { ContentService } from '../content/content.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { XpService } from '../xp/xp.service';

/**
 * The single place where "has this player finished this mission?" is answered.
 *
 * Progress is always *recomputed* from the recorded event stream by the pure engine, never
 * read from something the client sent and never trusted from a stored flag alone. The
 * UserMission row is a materialised view of that computation, so a corrupted or
 * hand-edited row is corrected on the next evaluation rather than believed.
 */
@Injectable()
export class ProgressService {
  private readonly logger = new Logger(ProgressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly events: EventsService,
    private readonly xp: XpService,
  ) {}

  async completedMissionIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.userMission.findMany({
      where: { userId, state: 'COMPLETED' },
      select: { missionId: true },
    });
    return rows.map((row) => row.missionId);
  }

  async revealedHintLevels(userId: string, missionId: string): Promise<number[]> {
    const row = await this.prisma.userMission.findUnique({
      where: { userId_missionId: { userId, missionId } },
      select: { revealedHintLevels: true },
    });
    return row?.revealedHintLevels ?? [];
  }

  /** Recomputes progress for one mission from its event stream. */
  async evaluate(userId: string, missionId: string, now = new Date()): Promise<MissionProgress> {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    const stream = await this.events.stream(userId, missionId);
    return evaluateMission(mission, stream, { now: now.toISOString() });
  }

  /** The state to show the player, combining the unlock gate with recorded progress. */
  async stateFor(userId: string, missionId: string): Promise<MissionState> {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    const completed = await this.completedMissionIds(userId);
    const row = await this.prisma.userMission.findUnique({
      where: { userId_missionId: { userId, missionId } },
      select: { state: true },
    });
    return missionState(mission, completed, row?.state as MissionState | undefined);
  }

  async assertUnlocked(userId: string, missionId: string): Promise<void> {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    const completed = await this.completedMissionIds(userId);
    if (!isUnlocked(mission, completed)) {
      throw new NotFoundException(
        `Mission "${missionId}" is locked. Finish what it requires first.`,
      );
    }
  }

  /**
   * Recomputes progress, writes the materialised row, and pays XP on the *first* completion.
   *
   * Called after every action that could change progress. Returns the result the player is
   * shown when the mission has just been finished.
   */
  async sync(
    userId: string,
    missionId: string,
  ): Promise<{
    progress: MissionProgress;
    result: MissionResult | null;
  }> {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    const progress = await this.evaluate(userId, missionId);
    const result = resultForMission(mission, progress);

    const existing = await this.prisma.userMission.findUnique({
      where: { userId_missionId: { userId, missionId } },
      select: { state: true, bestScore: true, bestRating: true, completedAt: true },
    });
    const alreadyCompleted = existing?.state === 'COMPLETED';

    const startedAt = progress.attempts > 0 ? new Date() : null;
    await this.prisma.userMission.upsert({
      where: { userId_missionId: { userId, missionId } },
      create: {
        userId,
        missionId,
        state: progress.state,
        attempts: progress.attempts,
        bestScore: result.score,
        bestRating: result.rating,
        startedAt,
        completedAt: progress.state === 'COMPLETED' ? new Date() : null,
      },
      update: {
        state: progress.state,
        attempts: progress.attempts,
        bestScore: Math.max(existing?.bestScore ?? 0, result.score),
        bestRating: Math.max(existing?.bestRating ?? 0, result.rating),
        completedAt: progress.state === 'COMPLETED' ? (existing?.completedAt ?? new Date()) : null,
      },
    });

    // XP is paid once. The ledger insert is itself idempotent on (mission, reason), so a
    // double-submitted flag or a replayed request cannot pay twice even if this check races.
    if (progress.state === 'COMPLETED' && !alreadyCompleted) {
      const awarded = await this.xp.award(userId, result.xpAwarded, 'mission.completed', missionId);
      if (awarded.awarded) {
        await this.xp.addSkills(userId, result.skills);
        await this.events.record(userId, missionId, 'MISSION_COMPLETED', { score: result.score });
        this.logger.log(`${userId} completed ${missionId} (+${result.xpAwarded} XP)`);
      }
      return { progress, result };
    }

    return { progress, result: progress.state === 'COMPLETED' ? result : null };
  }

  /**
   * Records the start of an attempt. Idempotent while an attempt is already in flight.
   *
   * The condition is `attempts`, not the mission state. Keying off the state meant that a
   * player who bought a hint before entering the lab was already IN_PROGRESS, so no start
   * event was ever recorded — and with nothing to measure from, the engine reported an
   * elapsed time of zero and the mission silently lost its efficiency bonus.
   */
  async start(userId: string, missionId: string): Promise<MissionProgress> {
    await this.assertUnlocked(userId, missionId);

    const progress = await this.evaluate(userId, missionId);
    const needsStart =
      progress.attempts === 0 || progress.state === 'ABANDONED' || progress.state === 'FAILED';
    if (needsStart) {
      await this.events.record(userId, missionId, 'MISSION_STARTED');
    }
    return (await this.sync(userId, missionId)).progress;
  }
}
