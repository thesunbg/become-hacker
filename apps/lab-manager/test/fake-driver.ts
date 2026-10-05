import type { AttachedTerminal, SandboxDriver, SandboxHandle } from '../src/driver.js';
import { assertSpecIsSafe, type SandboxSpec } from '../src/sandbox-spec.js';

/**
 * A driver that records what it was asked to create and runs nothing at all.
 *
 * Note what this is *not*: it is not a driver that executes the command on the host when
 * Docker is missing. Such a fallback would be convenient for testing and would also be the
 * precise vulnerability docs/06-security.md exists to prevent, so it does not exist.
 */
export class RecordingDriver implements SandboxDriver {
  readonly created: SandboxSpec[] = [];
  readonly destroyed: string[] = [];
  readonly written: string[] = [];
  readonly resizes: { cols: number; rows: number }[] = [];
  reachable = true;
  private counter = 0;

  async ping(): Promise<void> {
    if (!this.reachable) throw new Error('docker daemon not reachable');
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    assertSpecIsSafe(spec);
    this.created.push(spec);
    this.counter += 1;
    return {
      labId: spec.Labels['game.zeroroot.lab-id'] ?? 'unknown',
      containerId: `container-${this.counter}`,
    };
  }

  async attach(_handle: SandboxHandle): Promise<AttachedTerminal> {
    const driver = this;
    let dataListener: ((chunk: string) => void) | undefined;
    const closeListeners: (() => void)[] = [];

    return {
      write(data: string): void {
        driver.written.push(data);
        // Echo, so a test can observe the round trip.
        dataListener?.(data);
      },
      resize(cols: number, rows: number): void {
        driver.resizes.push({ cols, rows });
      },
      onData(listener): void {
        dataListener = listener;
      },
      onClose(listener): void {
        closeListeners.push(listener);
      },
      close(): void {
        for (const listener of closeListeners) listener();
      },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.destroyed.push(handle.containerId);
  }
}
