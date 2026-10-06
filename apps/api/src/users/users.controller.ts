import { Controller, Get, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { MeResponse } from '@zero-root/types';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { SessionService } from '../auth/session.service';
import { PrismaService } from '../prisma/prisma.service';
import { XpService, levelForXp } from '../xp/xp.service';

@Controller('api/me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly xp: XpService,
    private readonly sessions: SessionService,
  ) {}

  @Get()
  async me(@Req() req: AuthenticatedRequest): Promise<MeResponse> {
    const userId = req.userId as string;
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, username: true, profile: true },
    });

    // A live session whose account is gone. Answering 500 here would leave the client
    // retrying forever against a dashboard it can never load; 401 is the one thing that
    // makes it consider itself signed out, so revoke the session and say so.
    if (user === null) {
      await this.sessions.destroy(req.sessionToken);
      throw new UnauthorizedException('Not signed in.');
    }

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
