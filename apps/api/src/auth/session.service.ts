import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { RedisService } from '../redis/redis.service';

export interface SessionRecord {
  readonly userId: string;
  readonly createdAt: number;
}

/**
 * Opaque server-side sessions in Redis.
 *
 * The cookie carries a random id plus an HMAC of that id, never any claim about who the user
 * is. A forged or tampered cookie fails the signature check before Redis is touched, and a
 * stolen cookie stops working the moment the session is deleted. Nothing about the user's
 * identity or progress is readable from, or assertable by, the client.
 */
@Injectable()
export class SessionService {
  private static readonly PREFIX = 'session:';

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly redis: RedisService,
  ) {}

  private sign(id: string): string {
    return createHmac('sha256', this.config.sessionSecret).update(id).digest('base64url');
  }

  private static split(token: string): { id: string; signature: string } | null {
    const separator = token.lastIndexOf('.');
    if (separator <= 0 || separator === token.length - 1) return null;
    return { id: token.slice(0, separator), signature: token.slice(separator + 1) };
  }

  async create(userId: string): Promise<string> {
    const id = randomBytes(32).toString('base64url');
    await this.redis.client.set(
      `${SessionService.PREFIX}${id}`,
      JSON.stringify({ userId, createdAt: Date.now() } satisfies SessionRecord),
      'EX',
      this.config.sessionTtlSeconds,
    );
    return `${id}.${this.sign(id)}`;
  }

  /** Returns the session for a token, or null if the token is forged, expired or revoked. */
  async resolve(token: string | undefined): Promise<SessionRecord | null> {
    if (token === undefined || token === '') return null;

    const parts = SessionService.split(token);
    if (!parts) return null;

    const expected = Buffer.from(this.sign(parts.id));
    const presented = Buffer.from(parts.signature);
    if (expected.length !== presented.length || !timingSafeEqual(expected, presented)) return null;

    const raw = await this.redis.client.get(`${SessionService.PREFIX}${parts.id}`);
    if (raw === null) return null;

    try {
      return JSON.parse(raw) as SessionRecord;
    } catch {
      return null;
    }
  }

  async destroy(token: string | undefined): Promise<void> {
    if (token === undefined) return;
    const parts = SessionService.split(token);
    if (!parts) return;
    await this.redis.client.del(`${SessionService.PREFIX}${parts.id}`);
  }

  /** Signs every session of one user out, e.g. after a password change. */
  async destroyAllFor(userId: string): Promise<number> {
    let cursor = '0';
    let removed = 0;
    do {
      const [next, keys] = await this.redis.client.scan(
        cursor,
        'MATCH',
        `${SessionService.PREFIX}*`,
        'COUNT',
        200,
      );
      cursor = next;
      for (const key of keys) {
        const raw = await this.redis.client.get(key);
        if (raw === null) continue;

        // A record that will not parse belongs to nobody: `resolve` already refuses it, so it
        // can authenticate no one and it expires on its own TTL. What must not happen is this
        // loop throwing on it — the one caller that matters is "sign this player out
        // everywhere" after a password change, and a single unparseable key would otherwise
        // leave *every* session of theirs alive.
        let record: SessionRecord;
        try {
          record = JSON.parse(raw) as SessionRecord;
        } catch {
          continue;
        }

        if (record.userId === userId) {
          await this.redis.client.del(key);
          removed++;
        }
      }
    } while (cursor !== '0');
    return removed;
  }

  cookieOptions(): {
    httpOnly: true;
    sameSite: 'strict';
    secure: boolean;
    path: string;
    maxAge: number;
  } {
    return {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.sessionCookieSecure,
      path: '/',
      maxAge: this.config.sessionTtlSeconds * 1000,
    };
  }
}
