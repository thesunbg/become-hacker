import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
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

  /**
   * The player's live lab, if they have one.
   *
   * Expired sessions are swept first. The lab manager destroys a container when its time runs
   * out, but nothing tells the API — so without this a row stays ACTIVE forever and the
   * one-lab limit locks the player out of the game permanently.
   */
  async active(userId: string) {
    await this.expireStale(userId);
    return this.prisma.labSession.findFirst({
      where: { userId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(userId: string, missionId: string) {
    const mission = this.content.find(missionId);
    if (mission === undefined) throw new NotFoundException(`Unknown mission "${missionId}".`);

    // Locking is enforced here as well as on the mission routes: entering a lab is the
    // thing that actually matters, so the gate cannot live only in the UI.
    await this.progress.assertUnlocked(userId, missionId);

    const running = await this.active(userId);
    if (running !== null) {
      // Walking back into the lab you already have open is not starting a second one. The
      // player navigated away and came back, which should return them to their terminal
      // rather than refuse — refusing is how someone gets stranded with no way forward.
      if (running.missionId === missionId) {
        return this.describe(running);
      }
      throw new ConflictException({
        message: 'You already have a lab running for another mission.',
        // The client needs these to offer closing it; a bare message is a dead end.
        activeSessionId: running.id,
        activeMissionId: running.missionId,
      });
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

    return this.describe(session);
  }

  private describe(session: { id: string; missionId: string; expiresAt: Date }) {
    return {
      sessionId: session.id,
      missionId: session.missionId,
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

  /** Ends sessions whose time has run out. Scoped to one player when a id is given. */
  async expireStale(userId?: string): Promise<number> {
    const stale = await this.prisma.labSession.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { lt: new Date() },
        ...(userId === undefined ? {} : { userId }),
      },
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
