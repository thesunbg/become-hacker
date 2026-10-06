import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeResponse } from '@zero-root/types';
import { useSession } from '../src/store/session';

/**
 * Who the client thinks is signed in.
 *
 * The property worth protecting is that the store never *decides* this — it asks. A 401 from
 * `/api/me` is the only thing that makes the app consider itself signed out, and nothing in
 * the client can set `signed-in` without the server having answered. A store that cached a
 * boolean instead would be a client asserting its own identity, which rule 3 forbids.
 */

const ME: MeResponse = {
  id: 'u1',
  email: 'player@example.test',
  username: 'player',
  xp: 0,
  level: 1,
  reputation: 0,
  skills: [],
};

function stubFetch(responses: { status: number; body?: unknown }[]): string[] {
  const seen: string[] = [];
  let index = 0;
  globalThis.fetch = vi.fn(async (url: unknown) => {
    seen.push(String(url));
    const response = responses[Math.min(index++, responses.length - 1)] ?? { status: 500 };
    return {
      status: response.status,
      ok: response.status >= 200 && response.status < 300,
      text: async () => (response.body === undefined ? '' : JSON.stringify(response.body)),
    } as Response;
  }) as typeof fetch;
  return seen;
}

beforeEach(() => {
  useSession.setState({ me: null, status: 'unknown' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('before anything is known', () => {
  it('starts unknown rather than guessing either way', () => {
    // Guessing signed-out would flash the sign-in page at a player who is signed in;
    // guessing signed-in would show a dashboard with no data.
    expect(useSession.getState().status).toBe('unknown');
    expect(useSession.getState().me).toBeNull();
  });
});

describe('refresh', () => {
  it('becomes signed in when the server says who the player is', async () => {
    stubFetch([{ status: 200, body: ME }]);
    await useSession.getState().refresh();

    expect(useSession.getState().status).toBe('signed-in');
    expect(useSession.getState().me?.username).toBe('player');
  });

  it('becomes signed out on a 401, which is the only thing that decides it', async () => {
    useSession.setState({ me: ME, status: 'signed-in' });
    stubFetch([{ status: 401, body: { message: 'Not signed in.' } }]);
    await useSession.getState().refresh();

    expect(useSession.getState().status).toBe('signed-out');
    expect(useSession.getState().me).toBeNull();
  });

  it('becomes signed out when the API cannot be reached at all', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await useSession.getState().refresh();
    expect(useSession.getState().status).toBe('signed-out');
  });

  it('asks the server, rather than trusting what it already held', async () => {
    useSession.setState({ me: ME, status: 'signed-in' });
    const seen = stubFetch([{ status: 401 }]);
    await useSession.getState().refresh();

    expect(seen).toEqual(['/api/me']);
    expect(useSession.getState().status).toBe('signed-out');
  });
});

describe('signing in', () => {
  it('reads the player back from the server after the password is accepted', async () => {
    const seen = stubFetch([
      { status: 200, body: { id: 'u1' } },
      { status: 200, body: ME },
    ]);
    await useSession.getState().signIn('player@example.test', 'a-long-enough-password');

    expect(seen).toEqual(['/api/auth/login', '/api/me']);
    expect(useSession.getState().status).toBe('signed-in');
    expect(useSession.getState().me?.id).toBe('u1');
  });

  it('leaves the state alone when the password is wrong', async () => {
    stubFetch([{ status: 401, body: { message: 'Email or password is incorrect.' } }]);
    await expect(useSession.getState().signIn('player@example.test', 'wrong')).rejects.toThrow(
      /incorrect/,
    );

    expect(useSession.getState().status).toBe('unknown');
    expect(useSession.getState().me).toBeNull();
  });

  it('does not become signed in when the server accepts the password but then refuses /api/me', async () => {
    stubFetch([
      { status: 200, body: { id: 'u1' } },
      { status: 401, body: { message: 'Not signed in.' } },
    ]);
    await expect(
      useSession.getState().signIn('player@example.test', 'a-long-enough-password'),
    ).rejects.toThrow();
    expect(useSession.getState().status).not.toBe('signed-in');
  });
});

describe('signing up', () => {
  it('signs the new player straight in', async () => {
    const seen = stubFetch([
      { status: 201, body: { id: 'u2' } },
      { status: 200, body: { ...ME, id: 'u2', username: 'newcomer' } },
    ]);
    await useSession.getState().signUp('new@example.test', 'newcomer', 'a-long-enough-password');

    expect(seen).toEqual(['/api/auth/register', '/api/me']);
    expect(useSession.getState().me?.username).toBe('newcomer');
  });

  it('surfaces the server validation message rather than a generic failure', async () => {
    stubFetch([{ status: 400, body: { message: ['Password must be at least 12 characters.'] } }]);
    await expect(
      useSession.getState().signUp('new@example.test', 'newcomer', 'short'),
    ).rejects.toThrow(/at least 12 characters/);
  });
});

describe('signing out', () => {
  it('forgets the player', async () => {
    useSession.setState({ me: ME, status: 'signed-in' });
    stubFetch([{ status: 204 }]);
    await useSession.getState().signOut();

    expect(useSession.getState().status).toBe('signed-out');
    expect(useSession.getState().me).toBeNull();
  });

  it('forgets the player even when the request fails', async () => {
    // The cookie may already be gone. Leaving the UI signed in would strand them on a
    // dashboard every request 401s.
    useSession.setState({ me: ME, status: 'signed-in' });
    globalThis.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as typeof fetch;

    await expect(useSession.getState().signOut()).resolves.toBeUndefined();
    expect(useSession.getState().status).toBe('signed-out');
    expect(useSession.getState().me).toBeNull();
  });
});

describe('what the store does not do', () => {
  it('holds no password, anywhere', async () => {
    stubFetch([
      { status: 200, body: { id: 'u1' } },
      { status: 200, body: ME },
    ]);
    await useSession.getState().signIn('player@example.test', 'a-long-enough-password');

    expect(JSON.stringify(useSession.getState().me)).not.toContain('a-long-enough-password');
  });

  it('holds no token, because authentication is an HttpOnly cookie', async () => {
    stubFetch([{ status: 200, body: ME }]);
    await useSession.getState().refresh();

    const keys = Object.keys(useSession.getState().me ?? {});
    for (const forbidden of ['token', 'jwt', 'secret', 'password']) {
      expect(
        keys.some((key) => key.toLowerCase().includes(forbidden)),
        forbidden,
      ).toBe(false);
    }
  });
});
