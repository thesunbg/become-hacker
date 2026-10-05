import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { DockerDriver } from '../src/docker-driver.js';
import { SandboxUnavailableError } from '../src/driver.js';
import { buildSandboxSpec, type SandboxSpec } from '../src/sandbox-spec.js';
import { parseManifest } from '../src/manifest.js';
import { resolveLimits } from '../src/limits.js';

/**
 * The production driver, against a stand-in for the Docker daemon.
 *
 * There is no daemon in CI, which is exactly why this is worth testing with a fake: the
 * things that matter here are what the driver *asks* the runtime for, and what it does when
 * the runtime is not there. Both are security properties — a weakened spec would ship a
 * weaker lab, and a driver that fell back to the host on failure would run a player's
 * commands outside a container.
 */

const spec = (): SandboxSpec =>
  buildSandboxSpec({
    manifest: parseManifest('linux-basic', {}),
    limits: resolveLimits({}),
    labId: '11111111-1111-4111-8111-111111111111',
    missionId: 'ch01-mission-001',
    labNetwork: 'zeroroot-lab',
  });

interface FakeContainer {
  id: string;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  attach: ReturnType<typeof vi.fn>;
}

function fakeDocker(
  overrides: { failCreate?: Error; failPing?: Error; stream?: PassThrough } = {},
) {
  const stream = overrides.stream ?? new PassThrough();
  const container: FakeContainer = {
    id: 'container-abc',
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    resize: vi.fn(async () => undefined),
    attach: vi.fn(async () => stream),
  };

  const docker = {
    ping: vi.fn(async () => {
      if (overrides.failPing) throw overrides.failPing;
      return 'OK';
    }),
    createContainer: vi.fn(async (_spec?: unknown) => {
      if (overrides.failCreate) throw overrides.failCreate;
      return container;
    }),
    getContainer: vi.fn(() => container),
  };

  return { docker, container, stream };
}

const driverFor = (docker: unknown) =>
  // The constructor takes a dockerode instance, which is what makes this testable at all.
  new DockerDriver(docker as never);

/**
 * The spec with one rule broken, as plain mutable JSON.
 *
 * `SandboxSpec` is deeply readonly on purpose — the type itself is part of how the sandbox
 * stays safe — so weakening one is deliberately awkward and goes through a copy.
 */
function brokenSpec(mutate: (hostConfig: Record<string, unknown>) => void): SandboxSpec {
  const copy = JSON.parse(JSON.stringify(spec())) as { HostConfig: Record<string, unknown> };
  mutate(copy.HostConfig);
  return copy as unknown as SandboxSpec;
}

describe('ping', () => {
  it('passes when the daemon answers', async () => {
    const { docker } = fakeDocker();
    await expect(driverFor(docker).ping()).resolves.toBeUndefined();
  });

  it('reports the runtime unavailable rather than letting the error through raw', async () => {
    const { docker } = fakeDocker({ failPing: new Error('connect ENOENT /var/run/docker.sock') });
    await expect(driverFor(docker).ping()).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  it('says why no lab can start, and that labs never run outside a container', async () => {
    const { docker } = fakeDocker({ failPing: new Error('connect ENOENT') });
    await expect(driverFor(docker).ping()).rejects.toThrow(/never run outside a container/);
  });
});

describe('create', () => {
  it('hands the spec to the runtime unchanged, and starts it', async () => {
    const { docker, container } = fakeDocker();
    const wanted = spec();

    const handle = await driverFor(docker).create(wanted);

    expect(docker.createContainer).toHaveBeenCalledWith(wanted);
    expect(container.start).toHaveBeenCalledOnce();
    expect(handle).toEqual({
      labId: '11111111-1111-4111-8111-111111111111',
      containerId: 'container-abc',
    });
  });

  it('keeps the isolation rules in what it actually sends', async () => {
    const { docker } = fakeDocker();
    await driverFor(docker).create(spec());

    const sent = docker.createContainer.mock.calls[0]?.[0] as SandboxSpec | undefined;
    if (sent === undefined) throw new Error('the driver sent nothing to the runtime');
    expect(sent.HostConfig.Privileged).toBe(false);
    expect(sent.HostConfig.CapDrop).toEqual(['ALL']);
    expect(sent.HostConfig.ReadonlyRootfs).toBe(true);
    expect(sent.HostConfig.Binds ?? []).toEqual([]);
    expect(sent.HostConfig.NetworkMode).not.toBe('host');
  });

  it('refuses an unsafe spec without going anywhere near the runtime', async () => {
    const { docker } = fakeDocker();
    const unsafe = brokenSpec((host) => {
      host.Privileged = true;
    });

    await expect(driverFor(docker).create(unsafe)).rejects.toThrow();
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('refuses a spec that mounts the host filesystem', async () => {
    const { docker } = fakeDocker();
    const unsafe = brokenSpec((host) => {
      host.Binds = ['/:/host'];
    });

    await expect(driverFor(docker).create(unsafe)).rejects.toThrow();
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('reports the runtime unavailable when the container cannot be created', async () => {
    const { docker } = fakeDocker({ failCreate: new Error('no such image') });
    await expect(driverFor(docker).create(spec())).rejects.toBeInstanceOf(SandboxUnavailableError);
  });
});

describe('attach', () => {
  it('attaches a hijacked, bidirectional stream', async () => {
    const { docker, container } = fakeDocker();
    const handle = await driverFor(docker).create(spec());
    await driverFor(docker).attach(handle);

    expect(container.attach).toHaveBeenCalledWith({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    });
  });

  it('forwards what the player types into the container', async () => {
    const { docker, stream } = fakeDocker();
    const written: string[] = [];
    stream.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));

    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    terminal.write('whoami\r');
    await new Promise((resolve) => setImmediate(resolve));

    expect(written.join('')).toBe('whoami\r');
  });

  it('passes a resize through as the daemon expects it', async () => {
    const { docker, container } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    terminal.resize(120, 40);
    expect(container.resize).toHaveBeenCalledWith({ w: 120, h: 40 });
  });

  it('survives a resize the daemon rejects, because a dead container is not an error', async () => {
    const { docker, container } = fakeDocker();
    container.resize.mockRejectedValue(new Error('container is not running'));
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    expect(() => terminal.resize(80, 24)).not.toThrow();
  });

  it('keeps a multi-byte character whole when the stream splits it', async () => {
    // The pipe breaks wherever the kernel decides, which can be between the two bytes of
    // `à`. Decoding each chunk on its own produced two replacement marks instead.
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });

    const seen: string[] = [];
    terminal.onData((chunk) => seen.push(chunk));

    const bytes = Buffer.from('xin chào, người chơi\r\n', 'utf8');
    const cut = bytes.indexOf(Buffer.from('à', 'utf8')) + 1;
    stream.write(bytes.subarray(0, cut));
    stream.write(bytes.subarray(cut));
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen.join('')).toBe('xin chào, người chơi\r\n');
    expect(seen.join('')).not.toContain('�');
  });

  it('keeps a character whole even when every byte arrives separately', async () => {
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    const seen: string[] = [];
    terminal.onData((chunk) => seen.push(chunk));

    for (const byte of Buffer.from('người', 'utf8')) stream.write(Buffer.from([byte]));
    await new Promise((resolve) => setImmediate(resolve));

    expect(seen.join('')).toBe('người');
  });

  it('tells the gateway when the container goes away', async () => {
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });

    const closed = vi.fn();
    terminal.onClose(closed);
    stream.emit('end');
    expect(closed).toHaveBeenCalledOnce();
  });

  it('announces the close once, however many ways the stream ends', async () => {
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    const closed = vi.fn();
    terminal.onClose(closed);

    stream.emit('end');
    stream.emit('close');
    stream.emit('error', new Error('broken pipe'));
    expect(closed).toHaveBeenCalledOnce();
  });

  it('calls a listener registered after the close, rather than never', async () => {
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    stream.emit('close');

    const late = vi.fn();
    terminal.onClose(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('writes nothing once the stream has closed', async () => {
    const { docker, stream } = fakeDocker();
    const terminal = await driverFor(docker).attach({
      labId: 'lab',
      containerId: 'container-abc',
    });
    const written: string[] = [];
    stream.on('data', (chunk: Buffer) => written.push(chunk.toString('utf8')));

    terminal.close();
    terminal.write('rm -rf /');
    await new Promise((resolve) => setImmediate(resolve));
    expect(written.join('')).toBe('');
  });
});

describe('destroy', () => {
  it('stops and then removes the container', async () => {
    const { docker, container } = fakeDocker();
    await driverFor(docker).destroy({ labId: 'lab', containerId: 'container-abc' });

    expect(container.stop).toHaveBeenCalledWith({ t: 1 });
    expect(container.remove).toHaveBeenCalledWith({ force: true, v: true });
  });

  it('still removes when the container had already stopped', async () => {
    const { docker, container } = fakeDocker();
    container.stop.mockRejectedValue(new Error('container already stopped'));

    await expect(
      driverFor(docker).destroy({ labId: 'lab', containerId: 'container-abc' }),
    ).resolves.toBeUndefined();
    expect(container.remove).toHaveBeenCalledOnce();
  });

  it('treats a lab that is already gone as destroyed', async () => {
    // AutoRemove usually gets there first. Throwing here would leave the API believing a
    // session is still live, which is how a player gets locked out of every lab.
    const { docker, container } = fakeDocker();
    container.stop.mockRejectedValue(new Error('no such container'));
    container.remove.mockRejectedValue(new Error('no such container'));

    await expect(
      driverFor(docker).destroy({ labId: 'lab', containerId: 'container-abc' }),
    ).resolves.toBeUndefined();
  });
});
