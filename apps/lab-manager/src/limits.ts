/**
 * Resource limits for a lab container.
 *
 * Every field here is a ceiling from docs/06-security.md, and every one is clamped. The
 * environment can make a lab *smaller* than the default but never bigger than the hard
 * maximum: a misconfigured `LAB_MEMORY_LIMIT` should degrade the game, not hand a player a
 * machine big enough to be worth attacking.
 */

export interface LabLimits {
  /** Fractional CPU cores. */
  readonly cpus: number;
  readonly memoryBytes: number;
  readonly pids: number;
  /** Hard wall-clock ceiling on a session, in seconds. */
  readonly sessionSeconds: number;
}

/** docs/06-security.md section "Resource limits". */
export const LIMIT_BOUNDS = {
  cpus: { min: 0.25, max: 2, default: 1 },
  memoryBytes: { min: 128 * 1024 * 1024, max: 1024 * 1024 * 1024, default: 512 * 1024 * 1024 },
  pids: { min: 16, max: 512, default: 128 },
  sessionSeconds: { min: 60, max: 3600, default: 3600 },
} as const;

export function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, value));
}

/** Parses a docker-style size string: `512m`, `1g`, `268435456`. */
export function parseMemory(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*([kmgKMG]?)[bB]?$/.exec(raw.trim());
  if (!match) return undefined;
  const value = Number.parseFloat(match[1] as string);
  const unit = (match[2] ?? '').toLowerCase();
  const multiplier = unit === 'g' ? 1024 ** 3 : unit === 'm' ? 1024 ** 2 : unit === 'k' ? 1024 : 1;
  return Math.round(value * multiplier);
}

export function resolveLimits(env: Record<string, string | undefined>): LabLimits {
  const bounds = LIMIT_BOUNDS;
  return {
    cpus: clamp(
      Number.parseFloat(env.LAB_CPU_LIMIT ?? ''),
      bounds.cpus.min,
      bounds.cpus.max,
      bounds.cpus.default,
    ),
    memoryBytes: clamp(
      parseMemory(env.LAB_MEMORY_LIMIT) ?? Number.NaN,
      bounds.memoryBytes.min,
      bounds.memoryBytes.max,
      bounds.memoryBytes.default,
    ),
    pids: clamp(
      Number.parseInt(env.LAB_PIDS_LIMIT ?? '', 10),
      bounds.pids.min,
      bounds.pids.max,
      bounds.pids.default,
    ),
    sessionSeconds: clamp(
      Number.parseInt(env.LAB_SESSION_TIMEOUT_SECONDS ?? '', 10),
      bounds.sessionSeconds.min,
      bounds.sessionSeconds.max,
      bounds.sessionSeconds.default,
    ),
  };
}
