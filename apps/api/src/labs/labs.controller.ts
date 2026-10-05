import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import type { ActiveLabResponse, CreateLabResponse } from '@zero-root/types';
import { AuthGuard, type AuthenticatedRequest } from '../auth/auth.guard';
import { LabsService } from './labs.service';

export class CreateLabDto {
  @IsString()
  @Matches(/^ch[0-9]{2}-mission-[0-9]{3}$/, { message: 'Not a valid mission id.' })
  missionId!: string;
}

@Controller('api/labs')
@UseGuards(AuthGuard)
export class LabsController {
  constructor(private readonly labs: LabsService) {}

  /**
   * The lab the player currently has open, or null.
   *
   * Without this the client cannot show a way back into a lab it navigated away from, which
   * is how a player ends up unable to enter any lab at all.
   */
  @Get('active')
  async active(@Req() req: AuthenticatedRequest): Promise<ActiveLabResponse> {
    const session = await this.labs.active(req.userId as string);
    // Wrapped rather than returned bare: a handler returning null sends an empty body, which
    // a client reads as undefined and cannot distinguish from a failed request.
    if (session === null) return { lab: null };
    return {
      lab: {
        sessionId: session.id,
        missionId: session.missionId,
        expiresAt: session.expiresAt.toISOString(),
        terminalPath: `/ws/terminal?sessionId=${session.id}`,
      },
    };
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateLabDto,
  ): Promise<CreateLabResponse> {
    return this.labs.create(req.userId as string, dto.missionId);
  }

  @Delete(':id')
  @HttpCode(204)
  async destroy(@Req() req: AuthenticatedRequest, @Param('id') sessionId: string): Promise<void> {
    await this.labs.destroy(req.userId as string, sessionId);
  }
}
