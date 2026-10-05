import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module';
import { LabManagerClient } from './lab-manager.client';
import { LabsController } from './labs.controller';
import { LabsService } from './labs.service';

@Module({
  imports: [MissionsModule],
  controllers: [LabsController],
  providers: [LabsService, LabManagerClient],
  exports: [LabsService, LabManagerClient],
})
export class LabsModule {}
