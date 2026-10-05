import type { LabLimits } from './limits.js';
import type { LabManifest } from './manifest.js';

/**
 * Builds the container specification for a lab.
 *
 * Pure, and the only place a lab's shape is decided. Two properties matter more than any
 * detail in here:
 *
 *   1. **The security posture is not configurable.** Privileged mode, capabilities, the
 *      read-only root, `no-new-privileges` and the empty bind list are written here as
 *      constants. No manifest, mission, environment variable or API request can reach them,
 *      because nothing in the inputs is ever consulted for those fields.
 *   2. **It is testable without Docker.** The spec is data, so the security posture can be
 *      asserted in CI on a machine with no daemon — which is the only way a rule like "never
 *      privileged" stays true a year from now.
 *
 * See docs/06-security.md.
 */

export interface SandboxSpec {
  readonly Image: string;
  readonly Cmd: readonly string[];
  readonly User: string;
  readonly WorkingDir: string;
  readonly Env: readonly string[];
  readonly Tty: true;
  readonly OpenStdin: true;
  readonly StdinOnce: false;
  readonly AttachStdin: true;
  readonly AttachStdout: true;
  readonly AttachStderr: true;
  readonly Labels: Readonly<Record<string, string>>;
  readonly NetworkDisabled: boolean;
  readonly HostConfig: {
    readonly AutoRemove: true;
    readonly Privileged: false;
    readonly CapDrop: readonly ['ALL'];
    readonly CapAdd: readonly [];
    readonly SecurityOpt: readonly string[];
    readonly ReadonlyRootfs: true;
    readonly Tmpfs: Readonly<Record<string, string>>;
    readonly Binds: readonly [];
    readonly Mounts: readonly [];
    readonly NetworkMode: string;
    readonly PidsLimit: number;
    readonly Memory: number;
    readonly MemorySwap: number;
    readonly MemorySwappiness: 0;
    readonly NanoCpus: number;
    readonly Ulimits: readonly {
      readonly Name: string;
      readonly Soft: number;
      readonly Hard: number;
    }[];
    readonly RestartPolicy: { readonly Name: 'no' };
    readonly IpcMode: 'private';
    readonly UsernsMode: '';
    readonly Devices: readonly [];
    readonly DeviceCgroupRules: readonly [];
  };
}

export interface BuildSpecInput {
  readonly manifest: LabManifest;
  readonly limits: LabLimits;
  readonly labId: string;
  readonly missionId: string;
  /** Docker network name for `network: 'lab'` images. Must be an internal network. */
  readonly labNetwork: string;
  /** Registry/tag prefix for lab images. */
  readonly imagePrefix?: string;
}

/** A user specification that would run the lab as root, in any of its spellings. */
function isRoot(user: string): boolean {
  const normalized = user.trim().toLowerCase();
  return normalized === 'root' || normalized === '0' || normalized.startsWith('0:');
}

export function sandboxImageTag(image: string, prefix = 'zeroroot'): string {
  return image.includes(':') ? image : `${prefix}/${image}:latest`;
}

export function buildSandboxSpec(input: BuildSpecInput): SandboxSpec {
  const { manifest, limits, labId, missionId, labNetwork } = input;

  // Writes live in RAM and die with the container. `noexec` so a writable directory cannot
  // become a place to stage a binary, `nosuid` so it cannot become a place to stage a setuid
  // one, and a size cap so filling it cannot exhaust the host.
  const tmpfs: Record<string, string> = {};
  for (const path of manifest.writablePaths) {
    tmpfs[path] = 'rw,noexec,nosuid,nodev,size=16m';
  }

  return {
    Image: sandboxImageTag(manifest.image, input.imagePrefix),
    Cmd: [...manifest.command],
    // Never root, whatever the manifest asked for.
    User: isRoot(manifest.user) ? 'player' : manifest.user,
    WorkingDir: manifest.workingDir,
    Env: [
      'TERM=xterm-256color',
      `HOME=${manifest.workingDir}`,
      // The root filesystem is read-only; without this bash fails trying to save history.
      'HISTFILE=/dev/null',
    ],
    Tty: true,
    OpenStdin: true,
    StdinOnce: false,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
    Labels: {
      'game.zeroroot.lab': 'true',
      'game.zeroroot.lab-id': labId,
      'game.zeroroot.mission-id': missionId,
    },
    NetworkDisabled: manifest.network === 'none',
    HostConfig: {
      AutoRemove: true,
      Privileged: false,
      CapDrop: ['ALL'],
      CapAdd: [],
      SecurityOpt: ['no-new-privileges'],
      ReadonlyRootfs: true,
      Tmpfs: tmpfs,
      // Never a host path. A lab that can read the host filesystem is not a lab.
      Binds: [],
      Mounts: [],
      NetworkMode: manifest.network === 'none' ? 'none' : labNetwork,
      PidsLimit: limits.pids,
      Memory: limits.memoryBytes,
      // Equal to Memory disables swap: a lab cannot push its memory pressure onto the host.
      MemorySwap: limits.memoryBytes,
      MemorySwappiness: 0,
      NanoCpus: Math.round(limits.cpus * 1_000_000_000),
      Ulimits: [
        { Name: 'nproc', Soft: limits.pids, Hard: limits.pids },
        { Name: 'nofile', Soft: 1024, Hard: 1024 },
        // 64 MiB: enough for the missions, not enough to fill a tmpfs or a disk.
        { Name: 'fsize', Soft: 64 * 1024 * 1024, Hard: 64 * 1024 * 1024 },
      ],
      RestartPolicy: { Name: 'no' },
      IpcMode: 'private',
      UsernsMode: '',
      Devices: [],
      DeviceCgroupRules: [],
    },
  };
}

/**
 * Re-checks a built spec against the rules in docs/06-security.md.
 *
 * Belt and braces: `buildSandboxSpec` already makes these true by construction, and the
 * driver calls this before every create anyway. If someone later refactors the builder into
 * something configurable, this fails loudly instead of quietly shipping a privileged lab.
 */
export function assertSpecIsSafe(spec: SandboxSpec): void {
  const problems: string[] = [];
  const host = spec.HostConfig;

  if (host.Privileged !== false) problems.push('privileged mode is enabled');
  if (!host.CapDrop.includes('ALL')) problems.push('capabilities are not dropped');
  if (host.CapAdd.length > 0) problems.push('capabilities are being added back');
  if (host.ReadonlyRootfs !== true) problems.push('root filesystem is writable');
  if (!host.SecurityOpt.includes('no-new-privileges'))
    problems.push('no-new-privileges is not set');
  if (host.Binds.length > 0) problems.push('a host path is bind-mounted');
  if (host.Mounts.length > 0) problems.push('a host path is mounted');
  if (host.Devices.length > 0) problems.push('a host device is exposed');
  if (
    host.NetworkMode === 'host' ||
    host.NetworkMode === 'bridge' ||
    host.NetworkMode === 'default'
  ) {
    problems.push(`network mode "${host.NetworkMode}" can reach beyond the lab`);
  }
  if (!(host.PidsLimit > 0)) problems.push('process count is unbounded');
  if (!(host.Memory > 0)) problems.push('memory is unbounded');
  if (host.MemorySwap !== host.Memory) problems.push('swap is not disabled');
  if (!(host.NanoCpus > 0)) problems.push('CPU is unbounded');
  if (isRoot(spec.User)) problems.push('the lab would run as root');

  if (problems.length > 0) {
    throw new Error(`Refusing to start an unsafe lab: ${problems.join('; ')}`);
  }
}
