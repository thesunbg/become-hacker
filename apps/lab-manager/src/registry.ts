import type { LabLimits } from './limits.js';
import type { SandboxDriver, SandboxHandle } from './driver.js';

export interface LabSession {
  readonly labId: string;
  readonly missionId: string;
  readonly userId: string;
  readonly handle: SandboxHandle;
  readonly createdAt: number;
  readonly expiresAt: number;
}

/**
 * Tracks live labs and guarantees they die.
 *
 * The session timeout is a security control, not a convenience: a lab left running is a lab
 * nobody is watching. Expiry is enforced here rather than by the client, so closing the
 * browser tab, losing the websocket or crashing the API all still end in a destroyed
 * container.
 */
export class LabRegistry {
  private readonly sessions = new Map<string, LabSession>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly driver: SandboxDriver,
    private readonly onExpire?: (session: LabSession) => void,
  ) {}

  register(session: Omit<LabSession, 'expiresAt'>, limits: LabLimits): LabSession {
    const full: LabSession = {
      ...session,
      expiresAt: session.createdAt + limits.sessionSeconds * 1000,
    };
    this.sessions.set(full.labId, full);

    const timer = setTimeout(() => {
      void this.destroy(full.labId).then(() => this.onExpire?.(full));
    }, limits.sessionSeconds * 1000);
    // Never hold the process open just to wait for a lab to expire.
    timer.unref?.();
    this.timers.set(full.labId, timer);

    return full;
  }

  get(labId: string): LabSession | undefined {
    return this.sessions.get(labId);
  }

  list(): LabSession[] {
    return [...this.sessions.values()];
  }

  async destroy(labId: string): Promise<boolean> {
    const session = this.sessions.get(labId);
    if (!session) return false;

    this.sessions.delete(labId);
    const timer = this.timers.get(labId);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(labId);
    }
    await this.driver.destroy(session.handle);
    return true;
  }

  /** Destroys every live lab. Used on shutdown so a restart never orphans containers. */
  async destroyAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((labId) => this.destroy(labId)));
  }
}
