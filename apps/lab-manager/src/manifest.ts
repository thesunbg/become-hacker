/**
 * A lab image's manifest: `labs/<image>/lab.json`.
 *
 * Deliberately a *tiny* vocabulary. A manifest can describe what a lab needs in order to
 * work; it cannot describe anything that would weaken the sandbox. There is no field for
 * privileged mode, no field for a host mount, and no field for capabilities, because content
 * must not be able to ask for them — see `buildSandboxSpec`.
 */

export interface LabManifest {
  readonly image: string;
  /**
   * `none` gives the container no network interface at all. `lab` attaches it to the
   * internal lab network, which has no gateway and therefore no route off itself.
   */
  readonly network: 'none' | 'lab';
  readonly user: string;
  readonly workingDir: string;
  readonly command: readonly string[];
  /**
   * Paths that must be writable. Mounted as small tmpfs, so writes live in RAM, count
   * against the memory limit, and vanish with the container.
   */
  readonly writablePaths: readonly string[];
}

export const DEFAULT_MANIFEST: Omit<LabManifest, 'image'> = {
  network: 'none',
  user: 'player',
  workingDir: '/home/player',
  command: ['/bin/bash', '--login'],
  writablePaths: ['/tmp'],
};

const NETWORKS = new Set(['none', 'lab']);

/**
 * Validates a parsed manifest, falling back to the defaults field by field.
 *
 * Unknown keys are ignored rather than merged: a manifest that names `Privileged` gets no
 * say, because this function never reads it.
 */
export function parseManifest(image: string, raw: unknown): LabManifest {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};

  const network = source.network;
  const user = source.user;
  const workingDir = source.workingDir;
  const command = source.command;
  const writablePaths = source.writablePaths;

  return {
    image,
    network:
      typeof network === 'string' && NETWORKS.has(network)
        ? (network as 'none' | 'lab')
        : DEFAULT_MANIFEST.network,
    user: typeof user === 'string' && user !== '' && user !== 'root' ? user : DEFAULT_MANIFEST.user,
    workingDir:
      typeof workingDir === 'string' && workingDir.startsWith('/')
        ? workingDir
        : DEFAULT_MANIFEST.workingDir,
    command:
      Array.isArray(command) &&
      command.every((part) => typeof part === 'string') &&
      command.length > 0
        ? (command as string[])
        : DEFAULT_MANIFEST.command,
    writablePaths:
      Array.isArray(writablePaths) && writablePaths.every((path) => typeof path === 'string')
        ? (writablePaths as string[]).filter((path) => path.startsWith('/'))
        : DEFAULT_MANIFEST.writablePaths,
  };
}
