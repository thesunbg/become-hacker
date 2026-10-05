import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type {
  HintResponse,
  MissionDetailResponse,
  MissionListResponse,
  MissionProgress,
  PublicMission,
  SubmitFlagResponse,
} from '@zero-root/types';
import { toPublicMission, withoutKnowledge } from '@zero-root/types';
import { nextHint, revealedHints } from '@zero-root/mission-engine';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { ContentService } from '../content/content.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { ProgressService } from './progress.service';
import { MissionRegistryService } from './mission-registry.service';
import { SubmitFlagDto } from './missions.dto';

/** Flag guessing is throttled: cheap to add, and it closes the brute-force door entirely. */
const FLAG_ATTEMPT_WINDOW_SECONDS = 60;
const MAX_FLAG_ATTEMPTS = 20;

@Controller('api')
@UseGuards(AuthGuard)
export class MissionsController {
  constructor(
    private readonly content: ContentService,
    private readonly progress: ProgressService,
    private readonly events: EventsService,
    private readonly registry: MissionRegistryService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('chapters')
  async chapters(@Req() req: AuthenticatedRequest) {
    const userId = req.userId as string;
    const completed = new Set(await this.progress.completedMissionIds(userId));
    return {
      chapters: this.content.chapters().map((chapter) => ({
        ...chapter,
        completedCount: this.content
          .all()
          .filter((mission) => mission.chapter === chapter.chapter && completed.has(mission.id))
          .length,
      })),
    };
  }

  @Get('missions')
  async list(@Req() req: AuthenticatedRequest): Promise<MissionListResponse> {
    const userId = req.userId as string;
    const completedIds = await this.progress.completedMissionIds(userId);
    const completed = new Set(completedIds);

    const missions: PublicMission[] = [];
    for (const mission of this.content.all()) {
      if (!(await this.registry.isPublished(mission.id))) continue;

      const state = await this.progress.stateFor(userId, mission.id);
      const published = toPublicMission(
        mission,
        state,
        await this.progress.revealedHintLevels(userId, mission.id),
      );
      // The knowledge review is the reward for finishing; it is not browsable beforehand.
      missions.push(state === 'COMPLETED' ? published : withoutKnowledge(published));
    }

    const chapters = this.content.chapters().map((chapter) => ({
      ...chapter,
      completedCount: this.content
        .all()
        .filter((mission) => mission.chapter === chapter.chapter && completed.has(mission.id))
        .length,
    }));

    return { chapters, missions };
  }

  @Get('missions/:id')
  async detail(
    @Req() req: AuthenticatedRequest,
    @Param('id') missionId: string,
  ): Promise<MissionDetailResponse> {
    const userId = req.userId as string;
    const mission = this.content.find(missionId);
    if (mission === undefined || !(await this.registry.isPublished(missionId))) {
      throw new NotFoundException(`Unknown mission "${missionId}".`);
    }

    const state = await this.progress.stateFor(userId, missionId);
    const levels = await this.progress.revealedHintLevels(userId, missionId);
    const published = toPublicMission(mission, state, levels);

    // A locked mission shows its title and difficulty but not its briefing: the story is
    // part of the reward for getting there.
    if (state === 'LOCKED') {
      return {
        mission: { ...withoutKnowledge(published), story: '', objective: '' },
        progress: null,
        revealedHints: [],
      };
    }

    const row = await this.prisma.userMission.findUnique({
      where: { userId_missionId: { userId, missionId } },
      select: { id: true },
    });

    return {
      mission: state === 'COMPLETED' ? published : withoutKnowledge(published),
      progress: row === null ? null : await this.progress.evaluate(userId, missionId),
      revealedHints: revealedHints(mission, levels).map((hint) => ({
        level: hint.level,
        text: hint.text,
      })),
    };
  }

  @Post('missions/:id/start')
  async start(
    @Req() req: AuthenticatedRequest,
    @Param('id') missionId: string,
  ): Promise<{ progress: MissionProgress }> {
    const userId = req.userId as string;
    if (!(await this.registry.isPublished(missionId))) {
      throw new NotFoundException(`Unknown mission "${missionId}".`);
    }
    return { progress: await this.progress.start(userId, missionId) };
  }

  @Post('missions/:id/hint')
  async hint(
    @Req() req: AuthenticatedRequest,
    @Param('id') missionId: string,
  ): Promise<HintResponse> {
    const userId = req.userId as string;
    const mission = this.content.find(missionId);
    if (mission === undefined || !(await this.registry.isPublished(missionId))) {
      throw new NotFoundException(`Unknown mission "${missionId}".`);
    }
    await this.progress.assertUnlocked(userId, missionId);

    const levels = await this.progress.revealedHintLevels(userId, missionId);
    const hint = nextHint(mission, levels);
    if (hint === null) throw new BadRequestException('No hints left on this mission.');

    await this.prisma.userMission.upsert({
      where: { userId_missionId: { userId, missionId } },
      create: { userId, missionId, state: 'IN_PROGRESS', revealedHintLevels: [hint.level] },
      update: { revealedHintLevels: { push: hint.level } },
    });

    // The XP cost is applied once, by the engine, when the mission is scored — not deducted
    // here. One authority over XP math means a hint can never be charged twice, and a
    // player who buys hints without finishing never goes into debt.
    await this.events.record(userId, missionId, 'HINT_USED', {
      level: hint.level,
      xpCost: hint.xpCost,
    });

    return { level: hint.level, text: hint.text, xpCost: hint.xpCost };
  }

  @Post('missions/:id/flag')
  async submitFlag(
    @Req() req: AuthenticatedRequest,
    @Param('id') missionId: string,
    @Body() dto: SubmitFlagDto,
  ): Promise<SubmitFlagResponse> {
    const userId = req.userId as string;
    const mission = this.content.find(missionId);
    if (mission === undefined || !(await this.registry.isPublished(missionId))) {
      throw new NotFoundException(`Unknown mission "${missionId}".`);
    }
    await this.progress.assertUnlocked(userId, missionId);

    const attempts = await this.redis.hit(
      `flag-attempts:${userId}:${missionId}`,
      FLAG_ATTEMPT_WINDOW_SECONDS,
    );
    if (attempts > MAX_FLAG_ATTEMPTS) {
      throw new BadRequestException('Too many flag attempts. Wait a moment and think it through.');
    }

    // The comparison happens server-side against content the client has never seen. The
    // only thing that crosses back is a boolean.
    const correct = this.content.flagMatches(missionId, dto.value);
    await this.events.record(userId, missionId, 'FLAG_SUBMITTED', { correct });

    const { progress, result } = await this.progress.sync(userId, missionId);
    return { correct, progress, result };
  }

  @Get('me/progress')
  async myProgress(@Req() req: AuthenticatedRequest) {
    const userId = req.userId as string;
    const rows = await this.prisma.userMission.findMany({
      where: { userId },
      orderBy: { missionId: 'asc' },
      select: { missionId: true },
    });

    const missions: MissionProgress[] = [];
    for (const row of rows) {
      if (this.content.find(row.missionId) === undefined) continue;
      missions.push(await this.progress.evaluate(userId, row.missionId));
    }
    return { missions };
  }
}
