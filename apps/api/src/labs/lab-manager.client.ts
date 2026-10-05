import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/configuration';

export interface CreatedLab {
  readonly labId: string;
  readonly missionId: string;
  readonly expiresAt: string;
}

/**
 * The API's only route to a sandbox.
 *
 * Note the shape of this client: it can ask for a lab to be created and destroyed, and that
 * is all. There is no "run this command" call, because the API never executes player input —
 * keystrokes are proxied through the terminal gateway to a container the lab manager owns
 * (CLAUDE.md rule 6).
 */
@Injectable()
export class LabManagerClient {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${this.config.labManagerUrl}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-lab-token': this.config.labManagerToken,
          ...(init.headers ?? {}),
        },
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `The lab service is unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }

  async create(input: { image: string; missionId: string; userId: string }): Promise<CreatedLab> {
    const response = await this.request('/labs', {
      method: 'POST',
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      throw new ServiceUnavailableException(
        body.error ?? `The lab service refused to start a lab (${response.status}).`,
      );
    }
    return (await response.json()) as CreatedLab;
  }

  async destroy(labId: string): Promise<void> {
    await this.request(`/labs/${labId}`, { method: 'DELETE' }).catch(() => undefined);
  }

  /** The upstream WebSocket URL the terminal gateway proxies to. */
  attachUrl(labId: string): string {
    const base = this.config.labManagerUrl.replace(/^http/, 'ws');
    return `${base}/attach?labId=${encodeURIComponent(labId)}`;
  }

  get token(): string {
    return this.config.labManagerToken;
  }
}
