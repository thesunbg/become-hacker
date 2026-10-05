import { describe, expect, it } from 'vitest';
import { DEFAULT_MANIFEST, parseManifest } from '../src/manifest.js';

describe('parseManifest', () => {
  it('falls back to the defaults for an empty manifest', () => {
    expect(parseManifest('linux-basic', {})).toEqual({
      image: 'linux-basic',
      ...DEFAULT_MANIFEST,
    });
  });

  it('accepts the declarations a lab is allowed to make', () => {
    const manifest = parseManifest('network-basic', {
      network: 'lab',
      user: 'operator',
      workingDir: '/opt/work',
      command: ['/bin/sh'],
      writablePaths: ['/tmp', '/var/run'],
    });
    expect(manifest.network).toBe('lab');
    expect(manifest.user).toBe('operator');
    expect(manifest.workingDir).toBe('/opt/work');
    expect(manifest.command).toEqual(['/bin/sh']);
    expect(manifest.writablePaths).toEqual(['/tmp', '/var/run']);
  });

  it('refuses to run a lab as root, however the manifest asks', () => {
    expect(parseManifest('x', { user: 'root' }).user).toBe('player');
  });

  it('refuses an unrecognised network, rather than passing it to the runtime', () => {
    expect(parseManifest('x', { network: 'host' }).network).toBe('none');
    expect(parseManifest('x', { network: 'bridge' }).network).toBe('none');
  });

  it('ignores fields that would weaken the sandbox, because it never reads them', () => {
    const manifest = parseManifest('x', {
      Privileged: true,
      privileged: true,
      CapAdd: ['SYS_ADMIN'],
      capabilities: ['SYS_PTRACE'],
      Binds: ['/:/host'],
      binds: ['/etc:/etc'],
      readonlyRootfs: false,
      HostConfig: { Privileged: true },
    });
    expect(manifest).toEqual({ image: 'x', ...DEFAULT_MANIFEST });
  });

  it('drops a relative writable path, which could escape the intended directory', () => {
    expect(parseManifest('x', { writablePaths: ['tmp', '../etc', '/tmp'] }).writablePaths).toEqual([
      '/tmp',
    ]);
  });

  it('rejects a relative working directory', () => {
    expect(parseManifest('x', { workingDir: 'relative/path' }).workingDir).toBe(
      DEFAULT_MANIFEST.workingDir,
    );
  });

  it('rejects an empty command rather than starting a container with none', () => {
    expect(parseManifest('x', { command: [] }).command).toEqual(DEFAULT_MANIFEST.command);
    expect(parseManifest('x', { command: 'bash' }).command).toEqual(DEFAULT_MANIFEST.command);
  });

  it('survives a manifest that is not an object at all', () => {
    expect(parseManifest('x', null).user).toBe('player');
    expect(parseManifest('x', 'nonsense').user).toBe('player');
    expect(parseManifest('x', 42).user).toBe('player');
  });
});
