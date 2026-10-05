import { Global, Module } from '@nestjs/common';
import { ContentService } from './content.service';

@Global()
@Module({
  providers: [ContentService],
  exports: [ContentService],
})
export class ContentModule {}
