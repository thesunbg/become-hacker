import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { THROTTLE } from './config/configuration';
import { CsrfMiddleware } from './common/csrf.middleware';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { ContentModule } from './content/content.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { EventsModule } from './events/events.module';
import { XpModule } from './xp/xp.module';
import { MissionsModule } from './missions/missions.module';
import { LabsModule } from './labs/labs.module';
import { TerminalModule } from './terminal/terminal.module';

@Module({
  imports: [
    AppConfigModule,
    // Global rate limiting (docs/06-security.md). Individual routes tighten it further.
    ThrottlerModule.forRoot([{ ttl: THROTTLE.ttl, limit: THROTTLE.limit }]),
    PrismaModule,
    RedisModule,
    ContentModule,
    EventsModule,
    XpModule,
    AuthModule,
    UsersModule,
    MissionsModule,
    LabsModule,
    TerminalModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfMiddleware).forRoutes('*');
  }
}
