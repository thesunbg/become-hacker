import { describe, expect, it } from 'vitest';
import { loadAppConfig } from '../src/config/configuration';

/**
 * Configuration, which is where a deployment goes wrong silently.
 *
 * Every value here has a failure mode that looks like a bug in the application rather than a
 * setting: a wrong `WEB_ORIGIN` refuses every sign-in with a 403, `SESSION_COOKIE_SECURE`
 * left on without TLS makes the browser discard the cookie, and a production deployment that
 * fell back to the development session secret would be signable by anyone who read the
 * source. Each of those cost real debugging time, so each is pinned.
 */

const base = {
  SESSION_SECRET: 'a-session-secret-of-at-least-thirty-two-characters',
};

describe('the session secret', () => {
  it('refuses to start production on a short secret', () => {
    expect(() => loadAppConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short' })).toThrow(
      /at least 32 characters/,
    );
  });

  it('refuses to start production with no secret at all', () => {
    expect(() => loadAppConfig({ NODE_ENV: 'production' })).toThrow(/at least 32 characters/);
  });

  it('accepts a long enough secret in production', () => {
    expect(loadAppConfig({ NODE_ENV: 'production', ...base }).sessionSecret).toBe(
      base.SESSION_SECRET,
    );
  });

  it('falls back to a development secret only outside production', () => {
    const config = loadAppConfig({ NODE_ENV: 'development' });
    expect(config.sessionSecret).toContain('development-only');
    // Named so that finding it in a production deployment is unambiguous.
    expect(config.sessionSecret).toContain('change-me');
  });

  it('treats an empty secret as absent rather than as a one-character key', () => {
    expect(loadAppConfig({ SESSION_SECRET: '' }).sessionSecret).toContain('development-only');
  });
});

describe('the web origin', () => {
  it('uses what it is given', () => {
    expect(loadAppConfig({ ...base, WEB_ORIGIN: 'https://play.example.com' }).webOrigin).toBe(
      'https://play.example.com',
    );
  });

  it('keeps a non-default port, because the browser sends one in Origin', () => {
    // Dropping the port here is what made every POST return 403 on a deployment reached by IP.
    expect(loadAppConfig({ ...base, WEB_ORIGIN: 'http://203.0.113.9:8080' }).webOrigin).toBe(
      'http://203.0.113.9:8080',
    );
  });

  it('derives it from the platform hostname when it is not set', () => {
    expect(
      loadAppConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: 'zeroroot-production.up.railway.app' })
        .webOrigin,
    ).toBe('https://zeroroot-production.up.railway.app');
  });

  it('prefers an explicit origin over the platform hostname', () => {
    expect(
      loadAppConfig({
        ...base,
        WEB_ORIGIN: 'https://play.example.com',
        RAILWAY_PUBLIC_DOMAIN: 'zeroroot-production.up.railway.app',
      }).webOrigin,
    ).toBe('https://play.example.com');
  });

  it('ignores an empty value rather than producing an origin of nothing', () => {
    expect(loadAppConfig({ ...base, WEB_ORIGIN: '' }).webOrigin).toBe('http://localhost:5173');
    expect(loadAppConfig({ ...base, RAILWAY_PUBLIC_DOMAIN: '' }).webOrigin).toBe(
      'http://localhost:5173',
    );
  });

  it('falls back to the Vite dev server for local work', () => {
    expect(loadAppConfig(base).webOrigin).toBe('http://localhost:5173');
  });
});

describe('the session cookie', () => {
  it('is Secure in production by default', () => {
    expect(loadAppConfig({ NODE_ENV: 'production', ...base }).sessionCookieSecure).toBe(true);
  });

  it('is not Secure in development, where there is no TLS', () => {
    expect(loadAppConfig({ NODE_ENV: 'development', ...base }).sessionCookieSecure).toBe(false);
  });

  it('can be switched off explicitly, for reaching a server by IP before a certificate', () => {
    expect(
      loadAppConfig({ NODE_ENV: 'production', ...base, SESSION_COOKIE_SECURE: 'false' })
        .sessionCookieSecure,
    ).toBe(false);
  });

  it('treats anything other than "false" as on, so a typo fails safe', () => {
    for (const value of ['true', 'TRUE', '1', 'yes', 'no', '0', '']) {
      expect(
        loadAppConfig({ NODE_ENV: 'production', ...base, SESSION_COOKIE_SECURE: value })
          .sessionCookieSecure,
        value,
      ).toBe(true);
    }
  });

  it('carries a name and a lifetime', () => {
    const config = loadAppConfig(base);
    expect(config.sessionCookieName).toBe('zr_session');
    expect(config.sessionTtlSeconds).toBe(86_400);
  });

  it('can be renamed and re-timed', () => {
    const config = loadAppConfig({
      ...base,
      SESSION_COOKIE_NAME: 'zr_other',
      SESSION_TTL_SECONDS: '600',
    });
    expect(config.sessionCookieName).toBe('zr_other');
    expect(config.sessionTtlSeconds).toBe(600);
  });
});

describe('the port', () => {
  it('prefers the platform variable, which is what gets injected', () => {
    expect(loadAppConfig({ ...base, PORT: '8080', API_PORT: '3001' }).port).toBe(8080);
  });

  it('falls back to the local one', () => {
    expect(loadAppConfig({ ...base, API_PORT: '4000' }).port).toBe(4000);
  });

  it('defaults to 3001', () => {
    expect(loadAppConfig(base).port).toBe(3001);
  });
});

describe('the lab service', () => {
  it('defaults to loopback, never to a public address', () => {
    const config = loadAppConfig(base);
    expect(config.labManagerUrl).toBe('http://127.0.0.1:3002');
  });

  it('takes the service name it is given, which is how it is reached in Compose', () => {
    expect(
      loadAppConfig({ ...base, LAB_MANAGER_URL: 'http://lab-manager:3002' }).labManagerUrl,
    ).toBe('http://lab-manager:3002');
  });

  it('names its development token so one in production is obvious', () => {
    expect(loadAppConfig(base).labManagerToken).toContain('development-only');
  });
});

describe('rate limiting', () => {
  it('leaves the limiter switched on by default', () => {
    const config = loadAppConfig(base);
    expect(config.throttleTtlMs).toBe(60_000);
    expect(config.throttleLimit).toBe(120);
    // Tighter on the auth routes, but not so tight that a classroom behind one address
    // locks itself out of signing up.
    expect(config.authThrottleLimit).toBe(20);
    expect(config.authThrottleLimit).toBeLessThan(config.throttleLimit);
  });

  it('is configurable, which is what lets the test suite raise it instead of disabling it', () => {
    const config = loadAppConfig({
      ...base,
      THROTTLE_TTL_MS: '1000',
      THROTTLE_LIMIT: '99999',
      AUTH_THROTTLE_LIMIT: '88888',
    });
    expect(config.throttleTtlMs).toBe(1000);
    expect(config.throttleLimit).toBe(99_999);
    expect(config.authThrottleLimit).toBe(88_888);
  });
});

describe('the web client', () => {
  it('serves no SPA when no root is set, so the API can run alone', () => {
    expect(loadAppConfig(base).webRoot).toBe('');
  });

  it('serves it from an absolute path, which is what the image sets', () => {
    expect(loadAppConfig({ ...base, WEB_ROOT: '/app/apps/web/dist' }).webRoot).toBe(
      '/app/apps/web/dist',
    );
  });
});

describe('the whole config', () => {
  it('reads process.env when it is given nothing', () => {
    // test/setup-env.ts has populated it, so this must not throw or return an empty origin.
    const config = loadAppConfig();
    expect(config.webOrigin).not.toBe('');
    expect(config.sessionSecret.length).toBeGreaterThanOrEqual(32);
  });

  it('never carries a secret into a field meant for display', () => {
    const config = loadAppConfig({ ...base, LAB_MANAGER_TOKEN: 'super-secret-token' });
    expect(config.webOrigin).not.toContain('super-secret-token');
    expect(config.labManagerUrl).not.toContain('super-secret-token');
  });
});
