import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Test environment, applied before any application module is imported.
 *
 * It has to run this early because the throttle limits are read when `@Throttle` executes,
 * which is while the controller module is being loaded. Raising the ceilings here keeps the
 * rate limiter switched on — a test suite makes far more requests from one address than a
 * player ever would, and disabling the guard outright would stop it being exercised at all.
 */
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: TEST_DATABASE_URL,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
  SESSION_SECRET: 'test-session-secret-at-least-32-characters-long',
  WEB_ORIGIN: 'http://localhost:5173',
  CONTENT_DIR: join(repoRoot, 'content'),
  API_PORT: '0',
  THROTTLE_TTL_MS: '60000',
  THROTTLE_LIMIT: '100000',
  AUTH_THROTTLE_LIMIT: '100000',
});
