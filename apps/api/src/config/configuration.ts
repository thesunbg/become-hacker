export interface AppConfig {
  readonly nodeEnv: string;
  readonly port: number;
  readonly webOrigin: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly sessionSecret: string;
  readonly sessionCookieName: string;
  readonly sessionTtlSeconds: number;
  readonly contentDir: string;
  readonly labManagerUrl: string;
  readonly labManagerToken: string;
  /** Global request ceiling per window, and the window itself. */
  readonly throttleTtlMs: number;
  readonly throttleLimit: number;
  /** A tighter ceiling for the sign-in and sign-up routes. */
  readonly authThrottleLimit: number;
}

const DEV_SESSION_SECRET = 'development-only-session-secret-change-me';

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const sessionSecret = env.SESSION_SECRET ?? '';

  // A production deployment must not fall back to a known secret.
  if (nodeEnv === 'production' && sessionSecret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters in production.');
  }

  return {
    nodeEnv,
    port: Number.parseInt(env.API_PORT ?? '3001', 10),
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? 'redis://localhost:6379',
    sessionSecret: sessionSecret === '' ? DEV_SESSION_SECRET : sessionSecret,
    sessionCookieName: env.SESSION_COOKIE_NAME ?? 'zr_session',
    sessionTtlSeconds: Number.parseInt(env.SESSION_TTL_SECONDS ?? '86400', 10),
    contentDir: env.CONTENT_DIR ?? `${process.cwd()}/../../content`,
    labManagerUrl: env.LAB_MANAGER_URL ?? 'http://127.0.0.1:3002',
    labManagerToken: env.LAB_MANAGER_TOKEN ?? 'development-only-token',
    throttleTtlMs: Number.parseInt(env.THROTTLE_TTL_MS ?? '60000', 10),
    throttleLimit: Number.parseInt(env.THROTTLE_LIMIT ?? '120', 10),
    // 20 rather than a handful: a classroom or office behind one address should not lock
    // itself out of signing up.
    authThrottleLimit: Number.parseInt(env.AUTH_THROTTLE_LIMIT ?? '20', 10),
  };
}

/**
 * Throttle settings resolved at import time.
 *
 * `@Throttle` takes its numbers when the decorator runs, which is while the module is being
 * loaded — before any provider exists — so the auth routes cannot read them from injected
 * configuration.
 */
export const THROTTLE = (() => {
  const config = loadAppConfig();
  return {
    ttl: config.throttleTtlMs,
    limit: config.throttleLimit,
    authLimit: config.authThrottleLimit,
  };
})();

export const APP_CONFIG = Symbol('APP_CONFIG');
