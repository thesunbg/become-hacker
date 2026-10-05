import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveLimits, type LabLimits } from './limits.js';
import { parseManifest, type LabManifest } from './manifest.js';

export interface LabManagerConfig {
  readonly port: number;
  readonly limits: LabLimits;
  readonly labNetwork: string;
  readonly labsDir: string;
  readonly imagePrefix: string;
  /**
   * Shared secret the API presents on every request. The lab manager must never be
   * reachable from the internet, and this is the second lock on that door.
   */
  readonly apiToken: string;
}

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): LabManagerConfig {
  const token = env.LAB_MANAGER_TOKEN ?? '';
  if (token === '' && env.NODE_ENV === 'production') {
    throw new Error('LAB_MANAGER_TOKEN must be set outside development.');
  }

  return {
    port: Number.parseInt(env.LAB_MANAGER_PORT ?? '3002', 10),
    limits: resolveLimits(env),
    labNetwork: env.LAB_NETWORK ?? 'zeroroot-lab',
    labsDir: env.LABS_DIR ?? join(cwd, '../../labs'),
    imagePrefix: env.LAB_IMAGE_PREFIX ?? 'zeroroot',
    apiToken: token === '' ? 'development-only-token' : token,
  };
}

/** Image names are used to build a filesystem path, so they are strictly validated. */
export function isValidImageName(image: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,62}$/.test(image);
}

/**
 * Loads `labs/<image>/lab.json`, or the defaults when a lab ships no manifest.
 *
 * Returns null for an image that is not a known lab. That check is what stops a mission —
 * or a forged request — naming an arbitrary container image to run.
 */
export function loadManifest(config: LabManagerConfig, image: string): LabManifest | null {
  if (!isValidImageName(image)) return null;

  const dir = join(config.labsDir, image);
  if (!existsSync(dir)) return null;

  const manifestPath = join(dir, 'lab.json');
  if (!existsSync(manifestPath)) return parseManifest(image, {});

  try {
    return parseManifest(image, JSON.parse(readFileSync(manifestPath, 'utf8')));
  } catch {
    // A corrupt manifest must not escalate into a lab with no manifest at all.
    return null;
  }
}
