import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ContentService } from '../content/content.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Keeps the `missions` table in step with `content/`.
 *
 * The registry exists for foreign keys and for an admin to unpublish a mission. It carries
 * only non-secret metadata: no tasks, no hints and no flag, so no database row — and no
 * backup or admin screen — can leak a solution.
 */
@Injectable()
export class MissionRegistryService implements OnModuleInit {
  private readonly logger = new Logger(MissionRegistryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: ContentService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.sync();
  }

  async sync(): Promise<number> {
    const missions = this.content.all();

    for (const mission of missions) {
      const row = {
        chapter: mission.chapter,
        title: mission.title,
        difficulty: mission.difficulty,
        estimatedMinutes: mission.estimatedMinutes,
        xp: mission.xp,
        image: mission.environment.image,
      };
      await this.prisma.mission.upsert({
        where: { id: mission.id },
        create: { id: mission.id, ...row },
        // `published` is intentionally not overwritten: an admin's decision to disable a
        // mission must survive a redeploy that re-syncs content.
        update: row,
      });
    }

    this.logger.log(`Synced ${missions.length} mission(s) into the registry`);
    return missions.length;
  }

  async isPublished(missionId: string): Promise<boolean> {
    const row = await this.prisma.mission.findUnique({
      where: { id: missionId },
      select: { published: true },
    });
    return row?.published ?? false;
  }
}
