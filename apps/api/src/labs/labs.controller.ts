import { Body, Controller, Delete, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, Matches } from 'class-validator';
import type { CreateLabResponse } from '@zero-root/types';
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
