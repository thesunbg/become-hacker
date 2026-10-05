import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Test-only helper: clears game state while leaving the schema in place. */
  async truncateAll(): Promise<void> {
    await this.$executeRawUnsafe(`
      TRUNCATE TABLE lab_events, lab_sessions, xp_transactions, user_skills,
                     user_missions, audit_logs, profiles, users, missions
      RESTART IDENTITY CASCADE
    `);
  }
}
