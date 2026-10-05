import type { SandboxSpec } from './sandbox-spec.js';

export interface SandboxHandle {
  readonly labId: string;
  readonly containerId: string;
}

/** A live terminal attached to a sandbox. Bytes in, bytes out — nothing is interpreted here. */
export interface AttachedTerminal {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(listener: (chunk: string) => void): void;
  onClose(listener: () => void): void;
  close(): void;
}

/**
 * The boundary between the game and the container runtime.
 *
 * Note what is *not* in this interface: there is no "run a command" method that takes a
 * shell string, and no implementation that executes anything outside a container. When the
 * runtime is unavailable, a driver fails — it never falls back to the host, because a lab
 * whose commands run on the API host is the exact thing docs/06-security.md forbids.
 */
export interface SandboxDriver {
  /** Throws if the container runtime cannot be reached. */
  ping(): Promise<void>;
  create(spec: SandboxSpec): Promise<SandboxHandle>;
  attach(handle: SandboxHandle): Promise<AttachedTerminal>;
  destroy(handle: SandboxHandle): Promise<void>;
}

export class SandboxUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'The container runtime is unavailable, so no lab can be started. ' +
        'Labs are never run outside a container (docs/06-security.md). ' +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'SandboxUnavailableError';
  }
}
