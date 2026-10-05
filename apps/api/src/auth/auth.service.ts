import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import type { LoginDto, RegisterDto } from './auth.dto';

/** Login throttling, per docs/06-security.md. */
const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;
const MAX_LOGIN_ATTEMPTS = 10;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private async audit(action: string, userId: string | null, detail: string, ip?: string): Promise<void> {
    await this.prisma.auditLog.create({
      data: { action, userId, detail, ip: ip ?? null },
    });
  }

  async register(dto: RegisterDto, ip?: string): Promise<{ userId: string; token: string }> {
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim();

    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email }, { username }] },
      select: { id: true, email: true },
    });
    if (existing !== null) {
      // Registration necessarily reveals that an address is taken; that is unavoidable for
      // a unique-email signup. Login, below, reveals nothing.
      throw new ConflictException('That email or username is already registered.');
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        passwordHash: await this.passwords.hash(dto.password),
        profile: { create: {} },
      },
      select: { id: true },
    });

    await this.audit('auth.register', user.id, `username=${username}`, ip);
    return { userId: user.id, token: await this.sessions.create(user.id) };
  }

  async login(dto: LoginDto, ip?: string): Promise<{ userId: string; token: string }> {
    const email = dto.email.trim().toLowerCase();
    const attemptKey = `login-attempts:${email}`;

    const attempts = await this.redis.hit(attemptKey, LOGIN_ATTEMPT_WINDOW_SECONDS);
    if (attempts > MAX_LOGIN_ATTEMPTS) {
      await this.audit('auth.login.throttled', null, `email=${email}`, ip);
      throw new BadRequestException('Too many sign-in attempts. Try again later.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, passwordHash: true },
    });

    // Verify against a real hash even for an unknown account, so the response time does
    // not reveal whether the address exists. A fabricated hash string would fail to parse
    // and return early, which is exactly the timing signal this is here to remove.
    const digest = user?.passwordHash ?? (await this.decoyHash());
    const valid = await this.passwords.verify(digest, dto.password);

    if (user === null || !valid) {
      await this.audit('auth.login.failed', user?.id ?? null, `email=${email}`, ip);
      throw new UnauthorizedException('Email or password is incorrect.');
    }

    await this.redis.client.del(attemptKey);
    await this.audit('auth.login', user.id, '', ip);
    return { userId: user.id, token: await this.sessions.create(user.id) };
  }

  /** A real Argon2 hash of a value nobody knows, computed once and reused. */
  private decoy: Promise<string> | undefined;

  private decoyHash(): Promise<string> {
    this.decoy ??= this.passwords.hash(randomBytes(32).toString('hex'));
    return this.decoy;
  }

  async logout(token: string | undefined, userId: string | undefined, ip?: string): Promise<void> {
    await this.sessions.destroy(token);
    if (userId !== undefined) await this.audit('auth.logout', userId, '', ip);
  }

  get cookieName(): string {
    return this.config.sessionCookieName;
  }
}
