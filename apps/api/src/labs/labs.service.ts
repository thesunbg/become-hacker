import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProgressService } from '../missions/progress.service';
import { LabManagerClient } from './lab-manager.client';

/** One live lab per player: a second one would be a second unaudited machine. */
export const MAX_CONCURRENT_LABS_PER_USER = 1;

@Injectable()
export class LabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
    private readonly progress: ProgressService,
    private readonly events: EventsService,
    private readonly labManager: LabManagerClient,
  ) {}

  async create(userId: string, missionId: string) {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    // Locking is enforced here as well as on the mission routes: entering a lab is the
    // thing that actually matters, so the gate cannot live only in the UI.
    await this.progress.assertUnlocked(userId, missionId);

    const active = await this.prisma.labSession.count({
      where: { userId, status: 'ACTIVE' },
    });
    if (active >= MAX_CONCURRENT_LABS_PER_USER) {
      throw new BadRequestException(
        'You already have a lab running. Close it before starting another.',
      );
    }

    const created = await this.labManager.create({
      image: mission.environment.image,
      missionId,
      userId,
    });

    const session = await this.prisma.labSession.create({
      data: {
        userId,
        missionId,
        labId: created.labId,
        image: mission.environment.image,
        expiresAt: new Date(created.expiresAt),
      },
    });

    await this.progress.start(userId, missionId);

    return {
      sessionId: session.id,
      missionId,
      expiresAt: session.expiresAt.toISOString(),
      terminalPath: `/ws/terminal?sessionId=${session.id}`,
    };
  }

  async findActive(userId: string, sessionId: string) {
    return this.prisma.labSession.findFirst({
      where: { id: sessionId, userId, status: 'ACTIVE' },
    });
  }

  /** Looks up a session by id alone, for the gateway to authorise against its own owner. */
  async findById(sessionId: string) {
    return this.prisma.labSession.findUnique({ where: { id: sessionId } });
  }

  async destroy(userId: string, sessionId: string): Promise<void> {
    const session = await this.prisma.labSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (session === null) throw new NotFoundException('No such lab session.');

    if (session.labId !== null) await this.labManager.destroy(session.labId);

    await this.prisma.labSession.update({
      where: { id: session.id },
      data: { status: 'ENDED', endedAt: new Date(), labId: null },
    });

    // Leaving a lab unfinished is an abandoned attempt, not a failure: the player can walk
    // back in, and the engine treats completion as winning over a later abandon.
    const progress = await this.progress.evaluate(userId, session.missionId);
    if (progress.state !== 'COMPLETED') {
      await this.events.record(userId, session.missionId, 'MISSION_ABANDONED', {}, session.id);
    }
  }

  async expireStale(): Promise<number> {
    const stale = await this.prisma.labSession.findMany({
      where: { status: 'ACTIVE', expiresAt: { lt: new Date() } },
    });
    for (const session of stale) {
      if (session.labId !== null) await this.labManager.destroy(session.labId);
      await this.prisma.labSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED', endedAt: new Date(), labId: null },
      });
    }
    return stale.length;
  }
}
