import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

/**
 * Redis holds sessions, rate-limit counters and login-attempt counters.
 *
 * Nothing durable lives here: it is a cache and a clock, and the game survives losing it
 * (players get signed out). Progress, XP and events are in Postgres.
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new Redis(config.redisUrl, { lazyConnect: false, maxRetriesPerRequest: 2 });
    // An unreachable Redis must not crash the process on an unhandled error event.
    this.client.on('error', () => undefined);
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.quit().catch(() => undefined);
  }

  /** Increments a counter and returns its value, setting the window on first use. */
  async hit(key: string, windowSeconds: number): Promise<number> {
    const count = await this.client.incr(key);
    if (count === 1) await this.client.expire(key, windowSeconds);
    return count;
  }
}
