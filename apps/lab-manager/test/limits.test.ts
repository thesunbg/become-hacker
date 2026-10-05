import { describe, expect, it } from 'vitest';
import { LIMIT_BOUNDS, clamp, parseMemory, resolveLimits } from '../src/limits.js';

describe('parseMemory', () => {
  it('parses docker-style sizes', () => {
    expect(parseMemory('512m')).toBe(512 * 1024 * 1024);
    expect(parseMemory('1g')).toBe(1024 ** 3);
    expect(parseMemory('256k')).toBe(256 * 1024);
    expect(parseMemory('1024')).toBe(1024);
  });

  it('is case and suffix tolerant', () => {
    expect(parseMemory('512M')).toBe(512 * 1024 * 1024);
    expect(parseMemory('512MB')).toBe(512 * 1024 * 1024);
    expect(parseMemory(' 512m ')).toBe(512 * 1024 * 1024);
  });

  it('returns undefined for nonsense rather than guessing', () => {
    expect(parseMemory('lots')).toBeUndefined();
    expect(parseMemory('')).toBeUndefined();
    expect(parseMemory(undefined)).toBeUndefined();
  });
});

describe('clamp', () => {
  it('falls back for a non-numeric value', () => {
    expect(clamp(Number.NaN, 1, 10, 5)).toBe(5);
  });

  it('falls back for a non-positive value', () => {
    expect(clamp(0, 1, 10, 5)).toBe(5);
    expect(clamp(-3, 1, 10, 5)).toBe(5);
  });

  it('bounds on both sides', () => {
    expect(clamp(100, 1, 10, 5)).toBe(10);
    expect(clamp(0.5, 1, 10, 5)).toBe(1);
  });
});

describe('resolveLimits', () => {
  it('uses the documented defaults when nothing is configured', () => {
    const limits = resolveLimits({});
    expect(limits.cpus).toBe(LIMIT_BOUNDS.cpus.default);
    expect(limits.memoryBytes).toBe(LIMIT_BOUNDS.memoryBytes.default);
    expect(limits.pids).toBe(LIMIT_BOUNDS.pids.default);
    expect(limits.sessionSeconds).toBe(LIMIT_BOUNDS.sessionSeconds.default);
  });

  it('honours a configured value within bounds', () => {
    const limits = resolveLimits({
      LAB_CPU_LIMIT: '0.5',
      LAB_MEMORY_LIMIT: '256m',
      LAB_PIDS_LIMIT: '64',
      LAB_SESSION_TIMEOUT_SECONDS: '1800',
    });
    expect(limits).toEqual({
      cpus: 0.5,
      memoryBytes: 256 * 1024 * 1024,
      pids: 64,
      sessionSeconds: 1800,
    });
  });

  it('refuses to hand a lab more than the hard maximum, however it is configured', () => {
    const limits = resolveLimits({
      LAB_CPU_LIMIT: '64',
      LAB_MEMORY_LIMIT: '64g',
      LAB_PIDS_LIMIT: '100000',
      LAB_SESSION_TIMEOUT_SECONDS: '999999',
    });
    expect(limits.cpus).toBe(LIMIT_BOUNDS.cpus.max);
    expect(limits.memoryBytes).toBe(LIMIT_BOUNDS.memoryBytes.max);
    expect(limits.pids).toBe(LIMIT_BOUNDS.pids.max);
    expect(limits.sessionSeconds).toBe(LIMIT_BOUNDS.sessionSeconds.max);
  });

  it('never yields an unbounded lab from a garbage configuration', () => {
    const limits = resolveLimits({
      LAB_CPU_LIMIT: 'unlimited',
      LAB_MEMORY_LIMIT: '-1',
      LAB_PIDS_LIMIT: '0',
      LAB_SESSION_TIMEOUT_SECONDS: 'never',
    });
    expect(limits.cpus).toBeGreaterThan(0);
    expect(limits.memoryBytes).toBeGreaterThan(0);
    expect(limits.pids).toBeGreaterThan(0);
    expect(limits.sessionSeconds).toBeGreaterThan(0);
    expect(limits.sessionSeconds).toBeLessThanOrEqual(LIMIT_BOUNDS.sessionSeconds.max);
  });
});
