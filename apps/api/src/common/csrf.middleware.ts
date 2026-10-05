import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for a cookie-authenticated API.
 *
 * Sessions use `SameSite=Strict`, which already stops a cross-site form or image from
 * carrying the cookie. This is the second lock: a state-changing request must also present an
 * `Origin` (or `Referer`) that matches the configured web origin, so a browser that is lax
 * about SameSite — or a future relaxation of that attribute — does not silently become an
 * open door.
 *
 * Requests with no Origin at all are rejected for unsafe methods. That is stricter than the
 * common double-submit-token pattern and costs nothing, because every browser sends Origin on
 * cross-origin and same-origin unsafe requests alike.
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    const origin = req.headers.origin;
    if (origin !== undefined) {
      if (origin === this.config.webOrigin) {
        next();
        return;
      }
      res.status(403).json({ message: 'Cross-origin request refused.' });
      return;
    }

    const referer = req.headers.referer;
    if (typeof referer === 'string' && referer.startsWith(`${this.config.webOrigin}/`)) {
      next();
      return;
    }

    res.status(403).json({ message: 'Missing or untrusted request origin.' });
  }
}
