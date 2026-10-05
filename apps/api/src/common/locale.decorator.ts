import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { DEFAULT_LOCALE, isLocale, negotiateLocale, type Locale } from '@zero-root/types';

/**
 * The locale for this request.
 *
 * An explicit `x-locale` header wins, because a player who picked a language meant it. Failing
 * that, the browser's own `Accept-Language` is honoured, so a Vietnamese browser gets
 * Vietnamese without anyone choosing anything.
 *
 * Locale is presentation, not authority: it selects text and nothing else. A forged value can
 * at worst give the caller the wrong language.
 */
export const ReqLocale = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Locale => {
    const request = context.switchToHttp().getRequest<Request>();

    const header = request.headers['x-locale'];
    const explicit = Array.isArray(header) ? header[0] : header;
    if (isLocale(explicit)) return explicit;

    return negotiateLocale(request.headers['accept-language']) ?? DEFAULT_LOCALE;
  },
);
