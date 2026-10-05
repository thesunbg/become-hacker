import Docker from 'dockerode';
import type { Duplex } from 'node:stream';
import { assertSpecIsSafe, type SandboxSpec } from './sandbox-spec.js';
import {
  SandboxUnavailableError,
  type AttachedTerminal,
  type SandboxDriver,
  type SandboxHandle,
} from './driver.js';

/**
 * The production driver.
 *
 * This process is the only one in the system that holds a handle on the Docker socket, which
 * is the entire reason the lab manager is a separate service: the API, which is exposed to
 * the internet, must not be able to reach the runtime even if it is compromised.
 */
export class DockerDriver implements SandboxDriver {
  private readonly docker: Docker;

  constructor(docker: Docker = new Docker()) {
    this.docker = docker;
  }

  async ping(): Promise<void> {
    try {
      await this.docker.ping();
    } catch (error) {
      throw new SandboxUnavailableError(error);
    }
  }

  async create(spec: SandboxSpec): Promise<SandboxHandle> {
    // Checked again here, so a refactor of the builder cannot quietly ship a weaker lab.
    assertSpecIsSafe(spec);

    const labId = spec.Labels['game.zeroroot.lab-id'] ?? 'unknown';
    try {
      const container = await this.docker.createContainer(
        spec as unknown as Docker.ContainerCreateOptions,
      );
      await container.start();
      return { labId, containerId: container.id };
    } catch (error) {
      throw new SandboxUnavailableError(error);
    }
  }

  async attach(handle: SandboxHandle): Promise<AttachedTerminal> {
    const container = this.docker.getContainer(handle.containerId);
    const stream = (await container.attach({
      stream: true,
      stdin: true,
      stdout: true,
      stderr: true,
      hijack: true,
    })) as unknown as Duplex;

    let closed = false;
    const closeListeners: (() => void)[] = [];
    const fireClosed = (): void => {
      if (closed) return;
      closed = true;
      for (const listener of closeListeners) listener();
    };

    stream.on('end', fireClosed);
    stream.on('close', fireClosed);
    stream.on('error', fireClosed);

    return {
      write(data: string): void {
        if (!closed) stream.write(data);
      },
      resize(cols: number, rows: number): void {
        // A failed resize is cosmetic; the container may have already exited.
        void container.resize({ w: cols, h: rows }).catch(() => undefined);
      },
      onData(listener: (chunk: string) => void): void {
        // The container has a TTY, so the stream is raw rather than multiplexed.
        stream.on('data', (chunk: Buffer) => listener(chunk.toString('utf8')));
      },
      onClose(listener: () => void): void {
        if (closed) listener();
        else closeListeners.push(listener);
      },
      close(): void {
        fireClosed();
        stream.destroy();
      },
    };
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const container = this.docker.getContainer(handle.containerId);
    try {
      // The spec sets AutoRemove, so stopping is enough; remove covers a container that
      // never started cleanly. Both are best-effort: a lab that is already gone is fine.
      await container.stop({ t: 1 });
    } catch {
      /* already stopped */
    }
    try {
      await container.remove({ force: true, v: true });
    } catch {
      /* already removed by AutoRemove */
    }
  }
}
