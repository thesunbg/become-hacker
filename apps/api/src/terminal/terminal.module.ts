import { Module } from '@nestjs/common';
import { LabsModule } from '../labs/labs.module';
import { MissionsModule } from '../missions/missions.module';
import { TerminalGateway } from './terminal.gateway';

@Module({
  imports: [LabsModule, MissionsModule],
  providers: [TerminalGateway],
  exports: [TerminalGateway],
})
export class TerminalModule {}
