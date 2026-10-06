import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { LabManagerClient } from '../src/labs/lab-manager.client';
import type { AppConfig } from '../src/config/configuration';

/**
 * The API's only route to a sandbox.
 *
 * What is worth asserting here is as much about what this client *cannot* do as what it does.
 * It can ask for a lab and ask for one to be destroyed; there is no call that takes a command,
 * because the API never executes player input (CLAUDE.md rule 6). The shared token goes on
 * every request, since the lab manager must be unreachable without it.
 */

const config = {
  labManagerUrl: 'http://lab-manager:3002',
  labManagerToken: 'a-shared-token',
} as AppConfig;

interface Captured {
  url: string;
  init: RequestInit;
}

let calls: Captured[] = [];

function respondWith(
  status: number,
  body?: unknown,
  options: { throws?: Error } = {},
): LabManagerClient {
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    if (options.throws) throw options.throws;
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => {
        if (body === undefined) throw new Error('no body');
        return body;
      },
    } as Response;
  }) as typeof fetch;
  return new LabManagerClient(config);
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the shape of this client', () => {
  it('has no way to run a command', () => {
    const client = new LabManagerClient(config);
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(client) as object),
      ...Object.keys(client),
    ];
    for (const forbidden of ['exec', 'run', 'command', 'shell', 'spawn', 'eval']) {
      expect(
        surface.some((name) => name.toLowerCase().includes(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });
});

describe('create', () => {
  it('presents the shared token', async () => {
    const client = respondWith(201, { labId: 'lab-1', missionId: 'm', expiresAt: 'later' });
    await client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' });

    expect((calls[0]?.init.headers as Record<string, string>)['x-lab-token']).toBe(
      'a-shared-token',
    );
  });

  it('posts the image, mission and player to /labs', async () => {
    const client = respondWith(201, { labId: 'lab-1', missionId: 'm', expiresAt: 'later' });
    await client.create({ image: 'linux-basic', missionId: 'ch01-mission-001', userId: 'u1' });

    expect(calls[0]?.url).toBe('http://lab-manager:3002/labs');
    expect(calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      image: 'linux-basic',
      missionId: 'ch01-mission-001',
      userId: 'u1',
    });
  });

  it('returns the lab the service created', async () => {
    const client = respondWith(201, {
      labId: 'lab-1',
      missionId: 'ch01-mission-001',
      expiresAt: '2026-01-01T13:00:00.000Z',
    });
    await expect(
      client.create({ image: 'linux-basic', missionId: 'ch01-mission-001', userId: 'u1' }),
    ).resolves.toMatchObject({ labId: 'lab-1' });
  });

  it('reports the service unavailable when it refuses, carrying its reason', async () => {
    const client = respondWith(503, { error: 'The container runtime is unavailable.' });
    await expect(
      client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' }),
    ).rejects.toThrow(/container runtime is unavailable/);
  });

  it('still reports a usable message when the refusal has no body', async () => {
    const client = respondWith(500);
    await expect(
      client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' }),
    ).rejects.toThrow(/refused to start a lab \(500\)/);
  });

  it('reports the service unreachable rather than letting a network error through', async () => {
    const client = respondWith(0, undefined, { throws: new Error('ECONNREFUSED') });
    await expect(
      client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      client.create({ image: 'linux-basic', missionId: 'm', userId: 'u' }),
    ).rejects.toThrow(/lab service is unreachable/);
  });
});

describe('destroy', () => {
  it('deletes the lab by id', async () => {
    const client = respondWith(200, { destroyed: true });
    await client.destroy('lab-1');

    expect(calls[0]?.url).toBe('http://lab-manager:3002/labs/lab-1');
    expect(calls[0]?.init.method).toBe('DELETE');
  });

  it('swallows a failure, because a lab that is already gone is the desired state', async () => {
    // Throwing here would leave the API believing a session is live, which is how a player
    // gets locked out of every lab.
    const client = respondWith(0, undefined, { throws: new Error('ECONNREFUSED') });
    await expect(client.destroy('lab-1')).resolves.toBeUndefined();
  });

  it('swallows a refusal too', async () => {
    const client = respondWith(404, { error: 'not found' });
    await expect(client.destroy('lab-1')).resolves.toBeUndefined();
  });
});

describe('attachUrl', () => {
  it('turns the http base into a websocket one', () => {
    const client = new LabManagerClient(config);
    expect(client.attachUrl('lab-1')).toBe('ws://lab-manager:3002/attach?labId=lab-1');
  });

  it('upgrades https to wss rather than to ws', () => {
    const client = new LabManagerClient({
      ...config,
      labManagerUrl: 'https://lab-manager:3002',
    } as AppConfig);
    expect(client.attachUrl('lab-1')).toBe('wss://lab-manager:3002/attach?labId=lab-1');
  });

  it('encodes the lab id, so it cannot carry a second query parameter', () => {
    const client = new LabManagerClient(config);
    const url = client.attachUrl('lab-1&labId=someone-elses');
    expect(url).toBe('ws://lab-manager:3002/attach?labId=lab-1%26labId%3Dsomeone-elses');
    expect(new URL(url).searchParams.getAll('labId')).toEqual(['lab-1&labId=someone-elses']);
  });
});

describe('token', () => {
  it('exposes the configured token for the gateway to present on its own upgrade', () => {
    expect(new LabManagerClient(config).token).toBe('a-shared-token');
  });
});
