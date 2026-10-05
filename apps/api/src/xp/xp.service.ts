import { Injectable } from '@nestjs/common';
import type { MissionSkillReward } from '@zero-root/types';
import { PrismaService } from '../prisma/prisma.service';

// The level curve is shared with the web client: if the server awarded XP on one curve and
// the dashboard drew the bar on another, a player's level would change when they reloaded.
export { levelForXp, levelProgress, xpForLevel, LEVEL_BASE_XP } from '@zero-root/shared';

/**
 * XP as an append-only ledger (CLAUDE.md rule 5).
 *
 * There is no balance column to corrupt and no update path to get wrong: XP is granted by
 * inserting a row, and the total is a SUM. A disputed total can always be explained by
 * reading the rows that produced it, and a double-award shows up as two rows rather than as
 * a number nobody can account for.
 */
@Injectable()
export class XpService {
  constructor(private readonly prisma: PrismaService) {}

  async total(userId: string): Promise<number> {
    const result = await this.prisma.xpTransaction.aggregate({
      where: { userId },
      _sum: { amount: true },
    });
    return result._sum.amount ?? 0;
  }

  /**
   * Appends an XP grant.
   *
   * `missionId` plus `reason` is treated as idempotent: a repeated flag submission on an
   * already-completed mission must not pay twice, and the check lives here rather than in
   * each caller.
   */
  async award(
    userId: string,
    amount: number,
    reason: string,
    missionId?: string,
  ): Promise<{ awarded: boolean; total: number }> {
    if (missionId !== undefined) {
      const existing = await this.prisma.xpTransaction.findFirst({
        where: { userId, missionId, reason },
        select: { id: true },
      });
      if (existing !== null) {
        return { awarded: false, total: await this.total(userId) };
      }
    }

    await this.prisma.xpTransaction.create({
      data: { userId, amount, reason, missionId: missionId ?? null },
    });
    return { awarded: true, total: await this.total(userId) };
  }

  async history(userId: string, take = 50) {
    return this.prisma.xpTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take,
    });
  }

  /** Skill values are a running total, capped at 100 as the UI presents them. */
  async addSkills(userId: string, rewards: readonly MissionSkillReward[]): Promise<void> {
    for (const reward of rewards) {
      const current = await this.prisma.userSkill.findUnique({
        where: { userId_skill: { userId, skill: reward.skill } },
        select: { value: true },
      });
      const value = Math.min(100, (current?.value ?? 0) + reward.amount);
      await this.prisma.userSkill.upsert({
        where: { userId_skill: { userId, skill: reward.skill } },
        create: { userId, skill: reward.skill, value },
        update: { value },
      });
    }
  }

  async skills(userId: string): Promise<{ skill: string; value: number }[]> {
    const rows = await this.prisma.userSkill.findMany({
      where: { userId },
      orderBy: { value: 'desc' },
      select: { skill: true, value: true },
    });
    return rows;
  }
}
