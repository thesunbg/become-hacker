import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig, loadManifest } from '../src/config.js';

/**
 * The lab manager's configuration, and how it decides an image is a real lab.
 *
 * `loadManifest` is a security boundary, not a convenience: an image name becomes a
 * filesystem path and then a container to run, so the check that rejects anything which is
 * not a known lab is what stops a mission — or a forged request — naming an arbitrary image.
 */

let labs: string;

beforeAll(() => {
  labs = mkdtempSync(join(tmpdir(), 'zeroroot-labs-'));
  mkdirSync(join(labs, 'linux-basic'));
  writeFileSync(
    join(labs, 'linux-basic/lab.json'),
    JSON.stringify({ shell: ['/bin/bash', '-i'], user: 'player', workdir: '/home/player' }),
  );
  mkdirSync(join(labs, 'no-manifest'));
  mkdirSync(join(labs, 'broken'));
  writeFileSync(join(labs, 'broken/lab.json'), '{ not json');
});

afterAll(() => {
  rmSync(labs, { recursive: true, force: true });
});

const config = (env: Record<string, string | undefined> = {}) =>
  loadConfig({ LABS_DIR: labs, ...env }, '/srv/app');

describe('the API token', () => {
  it('refuses to start production without one', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/LAB_MANAGER_TOKEN must be set/);
  });

  it('refuses an empty one in production too', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', LAB_MANAGER_TOKEN: '' })).toThrow(
      /must be set/,
    );
  });

  it('accepts one in production', () => {
    expect(loadConfig({ NODE_ENV: 'production', LAB_MANAGER_TOKEN: 'a-token' }).apiToken).toBe(
      'a-token',
    );
  });

  it('names its development fallback so one in production is obvious', () => {
    expect(config().apiToken).toContain('development-only');
  });
});

describe('defaults', () => {
  it('listens on 3002 and publishes no port of its own choosing', () => {
    expect(config().port).toBe(3002);
    expect(config({ LAB_MANAGER_PORT: '4002' }).port).toBe(4002);
  });

  it('attaches labs to the internal lab network', () => {
    expect(config().labNetwork).toBe('zeroroot-lab');
    expect(config({ LAB_NETWORK: 'other-lab-net' }).labNetwork).toBe('other-lab-net');
  });

  it('resolves the labs directory two levels up, which is the repository root', () => {
    // The service runs from apps/lab-manager, so `../../labs` is the repo's labs/ directory.
    expect(loadConfig({}, '/srv/apps/lab-manager').labsDir).toBe('/srv/labs');
  });

  it('takes an explicit labs directory, which is how the image sets it', () => {
    expect(loadConfig({ LABS_DIR: '/app/labs' }, '/anywhere').labsDir).toBe('/app/labs');
  });

  it('prefixes images, so a lab image cannot be named after something else', () => {
    expect(config().imagePrefix).toBe('zeroroot');
  });

  it('carries the lab limits', () => {
    const limits = config({ LAB_MEMORY_LIMIT: '256m', LAB_PIDS_LIMIT: '64' }).limits;
    expect(limits.pids).toBe(64);
    expect(limits.memoryBytes).toBe(256 * 1024 * 1024);
  });
});

describe('loadManifest', () => {
  it('reads a lab that ships one', () => {
    expect(loadManifest(config(), 'linux-basic')).toMatchObject({ user: 'player' });
  });

  it('falls back to the defaults for a lab with no manifest', () => {
    expect(loadManifest(config(), 'no-manifest')).not.toBeNull();
  });

  it('refuses an image that is not a lab in this repository', () => {
    expect(loadManifest(config(), 'ubuntu')).toBeNull();
    expect(loadManifest(config(), 'alpine')).toBeNull();
  });

  it('refuses a path traversal dressed up as an image name', () => {
    for (const image of ['../../etc', '..', 'a/../../b', '/etc/passwd', 'linux-basic/../broken']) {
      expect(loadManifest(config(), image), image).toBeNull();
    }
  });

  it('refuses a registry reference, which would pull from the internet', () => {
    for (const image of [
      'docker.io/library/ubuntu',
      'ubuntu:latest',
      'ghcr.io/someone/thing',
      'linux-basic@sha256:abc',
    ]) {
      expect(loadManifest(config(), image), image).toBeNull();
    }
  });

  it('refuses a name with shell metacharacters', () => {
    for (const image of ['linux-basic;rm -rf /', 'linux basic', 'linux_basic', 'LINUX-BASIC', '']) {
      expect(loadManifest(config(), image), image).toBeNull();
    }
  });

  it('refuses a name that starts with a hyphen, which reads as a flag', () => {
    expect(loadManifest(config(), '-rf')).toBeNull();
  });

  it('refuses an absurdly long name', () => {
    expect(loadManifest(config(), 'a'.repeat(64))).toBeNull();
  });

  it('refuses a corrupt manifest rather than falling back to no manifest at all', () => {
    // Falling back would silently run a lab whose author had declared something specific.
    expect(loadManifest(config(), 'broken')).toBeNull();
  });
});
