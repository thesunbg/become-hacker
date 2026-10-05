import { describe, expect, it } from 'vitest';
import { assertSpecIsSafe, buildSandboxSpec, sandboxImageTag } from '../src/sandbox-spec.js';
import { parseManifest } from '../src/manifest.js';
import { LIMIT_BOUNDS, resolveLimits } from '../src/limits.js';

/**
 * The security posture of a lab, asserted as data.
 *
 * These are the tests that let docs/06-security.md stay true: they run in CI on a machine
 * with no Docker daemon, and they fail if anyone makes the sandbox weaker — whether through
 * the builder, a manifest, or configuration.
 */

const build = (manifestInput: unknown = {}, env: Record<string, string> = {}) =>
  buildSandboxSpec({
    manifest: parseManifest('linux-basic', manifestInput),
    limits: resolveLimits(env),
    labId: '11111111-1111-4111-8111-111111111111',
    missionId: 'ch01-mission-001',
    labNetwork: 'zeroroot-lab',
  });

describe('buildSandboxSpec — mandatory rules', () => {
  const spec = build();

  it('is never privileged', () => {
    expect(spec.HostConfig.Privileged).toBe(false);
  });

  it('drops all capabilities and adds none back', () => {
    expect(spec.HostConfig.CapDrop).toEqual(['ALL']);
    expect(spec.HostConfig.CapAdd).toEqual([]);
  });

  it('sets no-new-privileges', () => {
    expect(spec.HostConfig.SecurityOpt).toContain('no-new-privileges');
  });

  it('gives the lab a read-only root filesystem', () => {
    expect(spec.HostConfig.ReadonlyRootfs).toBe(true);
  });

  it('mounts no host path, by bind or by mount', () => {
    expect(spec.HostConfig.Binds).toEqual([]);
    expect(spec.HostConfig.Mounts).toEqual([]);
  });

  it('exposes no host device', () => {
    expect(spec.HostConfig.Devices).toEqual([]);
    expect(spec.HostConfig.DeviceCgroupRules).toEqual([]);
  });

  it('runs as an unprivileged user', () => {
    expect(spec.User).toBe('player');
  });

  it('removes itself when it stops and never restarts', () => {
    expect(spec.HostConfig.AutoRemove).toBe(true);
    expect(spec.HostConfig.RestartPolicy).toEqual({ Name: 'no' });
  });

  it('does not share the host IPC namespace', () => {
    expect(spec.HostConfig.IpcMode).toBe('private');
  });
});

describe('buildSandboxSpec — network isolation', () => {
  it('gives a chapter 1 lab no network at all', () => {
    const spec = build({ network: 'none' });
    expect(spec.NetworkDisabled).toBe(true);
    expect(spec.HostConfig.NetworkMode).toBe('none');
  });

  it('puts a network lab on the internal lab network', () => {
    const spec = build({ network: 'lab' });
    expect(spec.NetworkDisabled).toBe(false);
    expect(spec.HostConfig.NetworkMode).toBe('zeroroot-lab');
  });

  it('never uses a network mode that could reach the host or the internet', () => {
    for (const network of ['none', 'lab', 'host', 'bridge', 'default', undefined]) {
      const spec = build({ network });
      expect(['none', 'zeroroot-lab']).toContain(spec.HostConfig.NetworkMode);
    }
  });
});

describe('buildSandboxSpec — resource limits', () => {
  it('bounds processes, memory and CPU', () => {
    const spec = build({}, { LAB_CPU_LIMIT: '0.5', LAB_MEMORY_LIMIT: '256m', LAB_PIDS_LIMIT: '64' });
    expect(spec.HostConfig.PidsLimit).toBe(64);
    expect(spec.HostConfig.Memory).toBe(256 * 1024 * 1024);
    expect(spec.HostConfig.NanoCpus).toBe(500_000_000);
  });

  it('disables swap, so a lab cannot push memory pressure onto the host', () => {
    const spec = build();
    expect(spec.HostConfig.MemorySwap).toBe(spec.HostConfig.Memory);
    expect(spec.HostConfig.MemorySwappiness).toBe(0);
  });

  it('caps file size and open files', () => {
    const spec = build();
    const byName = Object.fromEntries(spec.HostConfig.Ulimits.map((u) => [u.Name, u]));
    expect(byName.fsize?.Hard).toBeGreaterThan(0);
    expect(byName.nofile?.Hard).toBeGreaterThan(0);
    expect(byName.nproc?.Hard).toBe(spec.HostConfig.PidsLimit);
  });

  it('stays bounded even when configuration asks for a huge lab', () => {
    const spec = build({}, { LAB_CPU_LIMIT: '99', LAB_MEMORY_LIMIT: '99g', LAB_PIDS_LIMIT: '99999' });
    expect(spec.HostConfig.NanoCpus).toBe(LIMIT_BOUNDS.cpus.max * 1_000_000_000);
    expect(spec.HostConfig.Memory).toBe(LIMIT_BOUNDS.memoryBytes.max);
    expect(spec.HostConfig.PidsLimit).toBe(LIMIT_BOUNDS.pids.max);
  });
});

describe('buildSandboxSpec — writable paths', () => {
  it('mounts declared paths as bounded tmpfs rather than making the root writable', () => {
    const spec = build({ writablePaths: ['/tmp', '/var/run'] });
    expect(spec.HostConfig.ReadonlyRootfs).toBe(true);
    expect(Object.keys(spec.HostConfig.Tmpfs).sort()).toEqual(['/tmp', '/var/run']);
    for (const options of Object.values(spec.HostConfig.Tmpfs)) {
      expect(options).toContain('noexec');
      expect(options).toContain('nosuid');
      expect(options).toContain('nodev');
      expect(options).toMatch(/size=\d+m/);
    }
  });

  it('does not mask the player home directory, which holds the mission files', () => {
    const spec = build();
    expect(Object.keys(spec.HostConfig.Tmpfs)).not.toContain('/home/player');
  });

  it('keeps bash from failing on a read-only root by discarding history', () => {
    expect(build().Env).toContain('HISTFILE=/dev/null');
  });
});

describe('buildSandboxSpec — escalation is not expressible', () => {
  it('ignores a manifest that asks for privileged mode', () => {
    const hostile = build({
      Privileged: true,
      HostConfig: { Privileged: true, Binds: ['/:/host'], CapAdd: ['SYS_ADMIN'] },
      CapAdd: ['SYS_ADMIN'],
      Binds: ['/var/run/docker.sock:/var/run/docker.sock'],
      ReadonlyRootfs: false,
      user: 'root',
      network: 'host',
    });

    expect(hostile.HostConfig.Privileged).toBe(false);
    expect(hostile.HostConfig.CapAdd).toEqual([]);
    expect(hostile.HostConfig.Binds).toEqual([]);
    expect(hostile.HostConfig.ReadonlyRootfs).toBe(true);
    expect(hostile.User).toBe('player');
    expect(hostile.HostConfig.NetworkMode).toBe('none');
    expect(() => assertSpecIsSafe(hostile)).not.toThrow();
  });

  it('never exposes the docker socket, which is the keys to the host', () => {
    const spec = build({ writablePaths: ['/var/run/docker.sock'] });
    expect(JSON.stringify(spec.HostConfig.Binds)).not.toContain('docker.sock');
    expect(JSON.stringify(spec.HostConfig.Mounts)).not.toContain('docker.sock');
  });

  it('refuses root spelled as a uid', () => {
    for (const user of ['0', '0:0', 'ROOT', ' root ']) {
      expect(build({ user }).User).toBe('player');
    }
  });
});

describe('assertSpecIsSafe', () => {
  const safe = build();

  it('passes a spec built the normal way', () => {
    expect(() => assertSpecIsSafe(safe)).not.toThrow();
  });

  const violations: [string, (spec: typeof safe) => unknown][] = [
    ['privileged mode', (s) => ({ ...s, HostConfig: { ...s.HostConfig, Privileged: true } })],
    ['capabilities are not dropped', (s) => ({ ...s, HostConfig: { ...s.HostConfig, CapDrop: [] } })],
    ['capabilities are being added back', (s) => ({ ...s, HostConfig: { ...s.HostConfig, CapAdd: ['SYS_ADMIN'] } })],
    ['root filesystem is writable', (s) => ({ ...s, HostConfig: { ...s.HostConfig, ReadonlyRootfs: false } })],
    ['no-new-privileges', (s) => ({ ...s, HostConfig: { ...s.HostConfig, SecurityOpt: [] } })],
    ['a host path is bind-mounted', (s) => ({ ...s, HostConfig: { ...s.HostConfig, Binds: ['/:/host'] } })],
    ['a host path is mounted', (s) => ({ ...s, HostConfig: { ...s.HostConfig, Mounts: [{}] } })],
    ['a host device is exposed', (s) => ({ ...s, HostConfig: { ...s.HostConfig, Devices: [{}] } })],
    ['can reach beyond the lab', (s) => ({ ...s, HostConfig: { ...s.HostConfig, NetworkMode: 'host' } })],
    ['process count is unbounded', (s) => ({ ...s, HostConfig: { ...s.HostConfig, PidsLimit: 0 } })],
    ['memory is unbounded', (s) => ({ ...s, HostConfig: { ...s.HostConfig, Memory: 0 } })],
    ['swap is not disabled', (s) => ({ ...s, HostConfig: { ...s.HostConfig, MemorySwap: -1 } })],
    ['CPU is unbounded', (s) => ({ ...s, HostConfig: { ...s.HostConfig, NanoCpus: 0 } })],
    ['would run as root', (s) => ({ ...s, User: 'root' })],
  ];

  for (const [description, mutate] of violations) {
    it(`rejects a spec where ${description}`, () => {
      expect(() => assertSpecIsSafe(mutate(safe) as typeof safe)).toThrow(/Refusing to start/);
      expect(() => assertSpecIsSafe(mutate(safe) as typeof safe)).toThrow(
        new RegExp(description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      );
    });
  }
});

describe('sandboxImageTag', () => {
  it('namespaces a bare image name', () => {
    expect(sandboxImageTag('linux-basic')).toBe('zeroroot/linux-basic:latest');
  });

  it('leaves an explicit tag alone', () => {
    expect(sandboxImageTag('zeroroot/linux-basic:dev')).toBe('zeroroot/linux-basic:dev');
  });
});
