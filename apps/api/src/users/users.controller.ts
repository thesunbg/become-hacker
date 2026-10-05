import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { MeResponse } from '@zero-root/types';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { XpService, levelForXp } from '../xp/xp.service';

@Controller('api/me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xp: XpService,
  ) {}

  @Get()
  async me(@Req() req: AuthenticatedRequest): Promise<MeResponse> {
    const userId = req.userId as string;
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { id: true, email: true, username: true, profile: true },
    });

    // Both derived, never stored: XP is a SUM over the ledger and level is a function of XP.
    const xp = await this.xp.total(userId);

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      level: levelForXp(xp),
      xp,
      reputation: user.profile?.reputation ?? 0,
      skills: await this.xp.skills(userId),
    };
  }
}
