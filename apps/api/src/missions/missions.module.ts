import { Module } from '@nestjs/common';
import { MissionsController } from './missions.controller';
import { MissionRegistryService } from './mission-registry.service';
import { ProgressService } from './progress.service';

@Module({
  controllers: [MissionsController],
  providers: [MissionRegistryService, ProgressService],
  exports: [MissionRegistryService, ProgressService],
})
export class MissionsModule {}
