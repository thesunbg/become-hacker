import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { Inject } from '@nestjs/common';
import { SessionService } from './session.service';
import { parseCookies } from '../common/cookies';

export interface AuthenticatedRequest extends Request {
  userId?: string;
  sessionToken?: string;
}

/**
 * Requires a valid session.
 *
 * Attaches only the user id to the request. Controllers therefore cannot be written to trust
 * a role, a level or an XP total supplied by the caller — there is nothing to trust, and
 * everything else is read from the database.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseCookies(request.headers.cookie)[this.config.sessionCookieName];
    if (token === undefined) throw new UnauthorizedException('Not signed in.');

    const session = await this.sessions.resolve(token);
    if (session === null) throw new UnauthorizedException('Not signed in.');

    request.userId = session.userId;
    request.sessionToken = token;
    return true;
  }
}
