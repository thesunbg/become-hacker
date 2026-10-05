import { Body, Controller, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { THROTTLE } from '../config/configuration';
import { serializeCookie } from '../common/cookies';
import { AuthService } from './auth.service';
import { AuthGuard, type AuthenticatedRequest } from './auth.guard';
import { LoginDto, RegisterDto } from './auth.dto';
import { SessionService } from './session.service';

@Controller('api/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
  ) {}

  private setSessionCookie(res: Response, token: string): void {
    res.setHeader(
      'set-cookie',
      serializeCookie(this.auth.cookieName, token, this.sessions.cookieOptions()),
    );
  }

  @Post('register')
  @Throttle({ default: { limit: THROTTLE.authLimit, ttl: THROTTLE.ttl } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string }> {
    const { userId, token } = await this.auth.register(dto, req.ip);
    this.setSessionCookie(res, token);
    return { id: userId };
  }

  @Post('login')
  @Throttle({ default: { limit: THROTTLE.authLimit, ttl: THROTTLE.ttl } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ id: string }> {
    const { userId, token } = await this.auth.login(dto, req.ip);
    this.setSessionCookie(res, token);
    return { id: userId };
  }

  @Post('logout')
  @HttpCode(204)
  @UseGuards(AuthGuard)
  async logout(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(req.sessionToken, req.userId, req.ip);
    res.setHeader(
      'set-cookie',
      serializeCookie(this.auth.cookieName, '', {
        ...this.sessions.cookieOptions(),
        maxAge: 0,
      }),
    );
  }
}
