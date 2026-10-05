import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LabRegistry } from '../src/registry.js';
import { resolveLimits } from '../src/limits.js';
import type { SandboxDriver, SandboxHandle } from '../src/driver.js';

/**
 * The registry is what guarantees a lab dies.
 *
 * Expiry lives here rather than in the client because every other place it could live can be
 * walked away from: closing the tab, losing the socket, restarting the API. A lab that
 * outlives its timer is a container nobody is watching, which docs/06-security.md does not
 * allow — so "the timer fires and the container is destroyed" is a security test.
 */

function fakeDriver() {
  const destroyed: string[] = [];
  const driver: SandboxDriver = {
    ping: async () => undefined,
    create: async () => ({ labId: 'unused', containerId: 'unused' }),
    attach: async () => {
      throw new Error('not used here');
    },
    destroy: async (handle: SandboxHandle) => {
      destroyed.push(handle.containerId);
    },
  };
  return { driver, destroyed };
}

const session = (labId: string, createdAt = Date.now()) => ({
  labId,
  missionId: 'ch01-mission-001',
  userId: 'user-1',
  handle: { labId, containerId: `container-${labId}` },
  createdAt,
});

const LIMITS = resolveLimits({ LAB_SESSION_TIMEOUT_SECONDS: '60' });

describe('register', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns the session with an expiry derived from the limit', () => {
    const { driver } = fakeDriver();
    const registry = new LabRegistry(driver);
    const created = Date.parse('2026-01-01T12:00:00.000Z');

    const registered = registry.register(session('a', created), LIMITS);

    expect(registered.expiresAt).toBe(created + 60_000);
    expect(registered.labId).toBe('a');
  });

  it('makes the session findable by its lab id', () => {
    const { driver } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    expect(registry.get('a')?.labId).toBe('a');
    expect(registry.get('b')).toBeUndefined();
  });

  it('lists every live lab', () => {
    const { driver } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);
    registry.register(session('b'), LIMITS);

    expect(
      registry
        .list()
        .map((entry) => entry.labId)
        .sort(),
    ).toEqual(['a', 'b']);
  });
});

describe('expiry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('destroys the container when the session timer runs out', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(destroyed).toEqual(['container-a']);
    expect(registry.get('a')).toBeUndefined();
  });

  it('does not destroy it early', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    await vi.advanceTimersByTimeAsync(59_000);

    expect(destroyed).toEqual([]);
    expect(registry.get('a')).toBeDefined();
  });

  it('tells its owner the lab expired, so the API can clear its own row', async () => {
    const { driver } = fakeDriver();
    const expired: string[] = [];
    const registry = new LabRegistry(driver, (entry) => expired.push(entry.labId));
    registry.register(session('a'), LIMITS);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(expired).toEqual(['a']);
  });

  it('expires each lab on its own clock', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);
    await vi.advanceTimersByTimeAsync(30_000);
    registry.register(session('b'), LIMITS);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(destroyed).toEqual(['container-a']);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(destroyed).toEqual(['container-a', 'container-b']);
  });

  it('does not destroy a lab twice when it was closed before expiring', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    await registry.destroy('a');
    await vi.advanceTimersByTimeAsync(120_000);

    expect(destroyed).toEqual(['container-a']);
  });
});

describe('destroy', () => {
  it('destroys the container and forgets the session', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    expect(await registry.destroy('a')).toBe(true);
    expect(destroyed).toEqual(['container-a']);
    expect(registry.get('a')).toBeUndefined();
  });

  it('reports nothing destroyed for a lab it never had', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);

    expect(await registry.destroy('nope')).toBe(false);
    expect(destroyed).toEqual([]);
  });

  it('is idempotent, so a repeated close is harmless', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);

    expect(await registry.destroy('a')).toBe(true);
    expect(await registry.destroy('a')).toBe(false);
    expect(destroyed).toEqual(['container-a']);
  });

  it('leaves other labs alone', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    registry.register(session('a'), LIMITS);
    registry.register(session('b'), LIMITS);

    await registry.destroy('a');
    expect(destroyed).toEqual(['container-a']);
    expect(registry.get('b')).toBeDefined();
  });
});

describe('destroyAll', () => {
  it('leaves no container behind on shutdown', async () => {
    const { driver, destroyed } = fakeDriver();
    const registry = new LabRegistry(driver);
    for (const labId of ['a', 'b', 'c']) registry.register(session(labId), LIMITS);

    await registry.destroyAll();

    expect(destroyed.sort()).toEqual(['container-a', 'container-b', 'container-c']);
    expect(registry.list()).toEqual([]);
  });

  it('does nothing when there is nothing running', async () => {
    const { driver, destroyed } = fakeDriver();
    await expect(new LabRegistry(driver).destroyAll()).resolves.toBeUndefined();
    expect(destroyed).toEqual([]);
  });
});
