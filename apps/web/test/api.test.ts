import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, messageFrom } from '../src/lib/api';
import { useLocaleStore } from '../src/i18n';

/**
 * The API client, against a stubbed fetch.
 *
 * Two things here are load-bearing and invisible: the session cookie, which only travels
 * because every request sets `credentials: 'include'`, and the `x-locale` header, which is
 * the only thing keeping the server-rendered mission text in the same language as the
 * interface around it. Both are one word in one object, and both break silently.
 */

interface Captured {
  url: string;
  init: RequestInit;
}

let calls: Captured[] = [];

function respondWith(status: number, body?: unknown, raw?: string): void {
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RequestInit });
    const text = raw ?? (body === undefined ? '' : JSON.stringify(body));
    return {
      status,
      ok: status >= 200 && status < 300,
      text: async () => text,
    } as Response;
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
  useLocaleStore.setState({ locale: 'en' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('every request', () => {
  it('sends the session cookie, which is the whole of authentication', async () => {
    respondWith(200, { id: 'u1', username: 'player' });
    await api.me();
    expect(calls[0]?.init.credentials).toBe('include');
  });

  it('tells the server which language the interface is showing', async () => {
    respondWith(200, { missions: [] });
    await api.missions();
    expect((calls[0]?.init.headers as Record<string, string>)['x-locale']).toBe('en');
  });

  it('follows the player changing language, without being re-created', async () => {
    respondWith(200, { missions: [] });
    useLocaleStore.setState({ locale: 'vi' });
    await api.missions();
    expect((calls[0]?.init.headers as Record<string, string>)['x-locale']).toBe('vi');
  });

  it('declares a JSON body only when it sends one', async () => {
    respondWith(200, { id: 'u1' });
    await api.login('player@example.test', 'a-long-enough-password');
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBe(
      'application/json',
    );

    calls = [];
    respondWith(200, { missions: [] });
    await api.missions();
    expect((calls[0]?.init.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect(calls[0]?.init.body).toBeUndefined();
  });

  it('never puts a credential in the URL', async () => {
    respondWith(200, { id: 'u1' });
    await api.login('player@example.test', 'a-long-enough-password');
    expect(calls[0]?.url).toBe('/api/auth/login');
    expect(calls[0]?.url).not.toContain('password');
  });

  it('uses a relative path, because the client and the API are one origin', async () => {
    respondWith(200, { missions: [] });
    await api.missions();
    expect(calls[0]?.url.startsWith('/api/')).toBe(true);
  });
});

describe('routes', () => {
  it('addresses each mission by id', async () => {
    respondWith(200, { mission: {}, progress: null, revealedHints: [] });
    await api.mission('ch01-mission-002');
    expect(calls[0]?.url).toBe('/api/missions/ch01-mission-002');

    calls = [];
    respondWith(201, { progress: {} });
    await api.startMission('ch01-mission-002');
    expect(calls[0]?.url).toBe('/api/missions/ch01-mission-002/start');
    expect(calls[0]?.init.method).toBe('POST');
  });

  it('submits a flag in the body rather than the URL', async () => {
    respondWith(200, { correct: true });
    await api.submitFlag('ch01-mission-002', 'ZR{h1dd3n}');
    expect(calls[0]?.url).toBe('/api/missions/ch01-mission-002/flag');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ value: 'ZR{h1dd3n}' }));
  });

  it('closes a lab with DELETE', async () => {
    respondWith(204);
    await api.destroyLab('session-1');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(calls[0]?.url).toBe('/api/labs/session-1');
  });

  it('asks for a lab by mission, never by image', async () => {
    respondWith(201, { sessionId: 's', missionId: 'ch01-mission-001' });
    await api.createLab('ch01-mission-001');
    expect(calls[0]?.init.body).toBe(JSON.stringify({ missionId: 'ch01-mission-001' }));
  });
});

describe('the active lab', () => {
  it('unwraps a lab the player has open', async () => {
    respondWith(200, { lab: { sessionId: 's1', missionId: 'ch01-mission-001' } });
    expect(await api.activeLab()).toMatchObject({ sessionId: 's1' });
  });

  it('reads an explicit null as no lab, not as a failure', async () => {
    respondWith(200, { lab: null });
    expect(await api.activeLab()).toBeNull();
  });

  it('survives a body with no lab key at all', async () => {
    respondWith(200, {});
    expect(await api.activeLab()).toBeNull();
  });
});

describe('failures', () => {
  it('raises an ApiError carrying the status', async () => {
    respondWith(401, { message: 'Not signed in.' });
    await expect(api.me()).rejects.toBeInstanceOf(ApiError);
    await expect(api.me()).rejects.toMatchObject({ status: 401, message: 'Not signed in.' });
  });

  it('joins the list of messages a validation error returns', async () => {
    respondWith(400, { message: ['Not a valid mission id.', 'value should not be empty'] });
    await expect(api.submitFlag('nope', '')).rejects.toThrow(
      'Not a valid mission id. value should not be empty',
    );
  });

  it('keeps the body, so a caller can act on more than the message', async () => {
    respondWith(409, {
      message: 'You already have a lab running for another mission.',
      activeSessionId: 's1',
      activeMissionId: 'ch01-mission-001',
    });
    await expect(api.createLab('ch01-mission-002')).rejects.toMatchObject({
      body: { activeMissionId: 'ch01-mission-001' },
    });
  });

  it('says something useful when the server sends no message', async () => {
    respondWith(500, undefined, '');
    await expect(api.me()).rejects.toThrow('Request failed (500).');
  });

  it('does not choke on a body that is not JSON, such as a proxy error page', async () => {
    respondWith(502, undefined, '<html>Bad Gateway</html>');
    await expect(api.me()).rejects.toThrow('Request failed (502).');
  });

  it('returns nothing for 204, rather than trying to parse an empty body', async () => {
    respondWith(204);
    await expect(api.logout()).resolves.toBeUndefined();
  });
});

describe('messageFrom', () => {
  it('ignores a message that is neither a string nor a list', () => {
    expect(messageFrom({ message: 42 })).toBeNull();
    expect(messageFrom({ message: [] })).toBeNull();
    expect(messageFrom({ message: {} })).toBeNull();
  });

  it('ignores a payload that is not an object', () => {
    expect(messageFrom('a string')).toBeNull();
    expect(messageFrom(null)).toBeNull();
    expect(messageFrom(undefined)).toBeNull();
  });
});
