import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SessionService } from '../src/auth/session.service';
import { Client, startHarness, type Harness } from './harness';

/**
 * Sessions: opaque ids in Redis, signed cookies, and revocation that actually revokes.
 *
 * The cookie carries a random id and an HMAC of it — never a claim about who the user is. So
 * the properties worth proving are that nothing about identity is readable from the cookie or
 * assertable by the client, that a tampered cookie fails before Redis is touched, and that
 * deleting the session stops it working immediately rather than at expiry.
 */

let harness: Harness;
let sessions: SessionService;

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
  sessions = harness.get<SessionService>(SessionService);
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function register(): Promise<{
  client: Client;
  userId: string;
  cookie: string;
  setCookie: string;
}> {
  const client = new Client(harness.baseUrl);
  const id = unique();
  const response = await client.post('/api/auth/register', {
    email: `session-${id}@example.test`,
    username: `session_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  // Captured before any further request overwrites it.
  const setCookie = client.lastSetCookie ?? '';
  const me = await client.get('/api/me');
  return { client, userId: me.body.id, cookie: client.cookie, setCookie };
}

const tokenFrom = (cookie: string) => cookie.replace(/^zr_session=/, '');

describe('the cookie', () => {
  it('is HttpOnly, SameSite=Strict and scoped to the whole site', async () => {
    const { setCookie } = await register();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Strict/i);
    expect(setCookie).toMatch(/Path=\//);
  });

  it('is not marked Secure in the test environment, where there is no TLS', async () => {
    const { setCookie } = await register();
    expect(setCookie).not.toMatch(/Secure/i);
  });

  it('carries no claim about the player', async () => {
    const { client, userId, cookie } = await register();
    const me = await client.get('/api/me');
    const token = decodeURIComponent(tokenFrom(cookie));
    const id = token.split('.')[0] ?? '';
    const decoded = Buffer.from(id, 'base64url').toString('latin1');

    // Not the id, not the name, not the email — and nothing decodable into them.
    for (const secret of [userId, me.body.email as string, me.body.username as string]) {
      expect(token).not.toContain(secret);
      expect(decoded).not.toContain(secret);
    }
  });

  it('is 32 bytes of randomness, not an encoding of anything', async () => {
    const { cookie } = await register();
    const id = decodeURIComponent(tokenFrom(cookie)).split('.')[0] ?? '';
    expect(Buffer.from(id, 'base64url')).toHaveLength(32);
  });

  it('is an id and a signature, not a JWT', async () => {
    const { cookie } = await register();
    const token = decodeURIComponent(tokenFrom(cookie));
    expect(token.split('.')).toHaveLength(2);
    expect(token.startsWith('eyJ')).toBe(false);
  });

  it('is different for every sign-in', async () => {
    const first = await register();
    const again = await first.client.post('/api/auth/login', {
      email: (await first.client.get('/api/me')).body.email,
      password: 'a-long-enough-password',
    });
    expect(again.status).toBe(201);
    expect(first.client.cookie).not.toBe(first.cookie);
  });
});

describe('resolving a token', () => {
  it('accepts the one the server issued', async () => {
    const { userId, cookie } = await register();
    const record = await sessions.resolve(decodeURIComponent(tokenFrom(cookie)));
    expect(record?.userId).toBe(userId);
  });

  it('refuses a tampered signature', async () => {
    const { cookie } = await register();
    const [id, signature] = decodeURIComponent(tokenFrom(cookie)).split('.');
    const flipped = `${(signature ?? '').slice(0, -1)}${(signature ?? '').endsWith('A') ? 'B' : 'A'}`;
    expect(await sessions.resolve(`${id}.${flipped}`)).toBeNull();
  });

  it('refuses a tampered id, even with the signature left alone', async () => {
    const { cookie } = await register();
    const [id, signature] = decodeURIComponent(tokenFrom(cookie)).split('.');
    expect(await sessions.resolve(`${(id ?? '').slice(0, -1)}X.${signature}`)).toBeNull();
  });

  it('refuses a token with no signature at all', async () => {
    const { cookie } = await register();
    const [id] = decodeURIComponent(tokenFrom(cookie)).split('.');
    expect(await sessions.resolve(id)).toBeNull();
    expect(await sessions.resolve(`${id}.`)).toBeNull();
  });

  it('refuses malformed tokens without throwing', async () => {
    for (const token of ['', '.', '..', 'a.', '.b', 'no-dot-at-all', undefined]) {
      expect(await sessions.resolve(token), String(token)).toBeNull();
    }
  });

  it('refuses a signature of the right shape for a different id', async () => {
    const one = await register();
    const two = await register();
    const [idOne] = decodeURIComponent(tokenFrom(one.cookie)).split('.');
    const [, signatureTwo] = decodeURIComponent(tokenFrom(two.cookie)).split('.');
    expect(await sessions.resolve(`${idOne}.${signatureTwo}`)).toBeNull();
  });

  it('refuses a correctly signed id that is not in Redis', async () => {
    // The signature proves this server minted the shape, not that the session still exists.
    const token = await sessions.create('user-that-will-be-revoked');
    const [id] = token.split('.');
    await harness.redis.del(`session:${id}`);
    expect(await sessions.resolve(token)).toBeNull();
  });

  it('refuses a session whose stored record is corrupt', async () => {
    const token = await sessions.create('user-with-corrupt-record');
    const [id] = token.split('.');
    await harness.redis.set(`session:${id}`, 'not json');
    expect(await sessions.resolve(token)).toBeNull();
  });
});

describe('the stored session', () => {
  it('holds only the user id and when it started', async () => {
    const token = await sessions.create('user-abc');
    const [id] = token.split('.');
    const raw = await harness.redis.get(`session:${id}`);
    expect(JSON.parse(raw ?? '{}')).toEqual({
      userId: 'user-abc',
      createdAt: expect.any(Number),
    });
  });

  it('expires on its own, so an abandoned session does not live forever', async () => {
    const token = await sessions.create('user-abc');
    const [id] = token.split('.');
    const ttl = await harness.redis.ttl(`session:${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(86_400);
  });

  it('stops working the moment it is gone, not at expiry', async () => {
    const { client } = await register();
    expect((await client.get('/api/me')).status).toBe(200);

    const [id] = decodeURIComponent(tokenFrom(client.cookie)).split('.');
    await harness.redis.del(`session:${id}`);

    expect((await client.get('/api/me')).status).toBe(401);
  });
});

describe('signing out', () => {
  it('revokes the cookie it was given', async () => {
    const { client } = await register();
    const before = client.cookie;

    expect((await client.post('/api/auth/logout')).status).toBeLessThan(300);
    // Even presenting the old cookie by hand, the session is gone.
    expect((await client.get('/api/me', { cookie: before })).status).toBe(401);
  });

  it('leaves another device signed in', async () => {
    const first = await register();
    const email = (await first.client.get('/api/me')).body.email;

    const second = new Client(harness.baseUrl);
    expect(
      (await second.post('/api/auth/login', { email, password: 'a-long-enough-password' })).status,
    ).toBe(201);

    await first.client.post('/api/auth/logout');
    expect((await first.client.get('/api/me', { cookie: first.cookie })).status).toBe(401);
    expect((await second.get('/api/me')).status).toBe(200);
  });

  it('is harmless when there is no session', async () => {
    const client = new Client(harness.baseUrl);
    const response = await client.post('/api/auth/logout');
    expect(response.status).toBeLessThan(500);
  });
});

describe('signing every device out', () => {
  it('removes every session of one player and leaves others alone', async () => {
    const mine = await register();
    const theirs = await register();
    const email = (await mine.client.get('/api/me')).body.email;

    const second = new Client(harness.baseUrl);
    await second.post('/api/auth/login', { email, password: 'a-long-enough-password' });

    const removed = await sessions.destroyAllFor(mine.userId);
    expect(removed).toBeGreaterThanOrEqual(2);

    expect((await mine.client.get('/api/me', { cookie: mine.cookie })).status).toBe(401);
    expect((await second.get('/api/me')).status).toBe(401);
    expect((await theirs.client.get('/api/me')).status).toBe(200);
  });

  it('reports nothing removed for a player with no sessions', async () => {
    expect(await sessions.destroyAllFor('nobody-at-all')).toBe(0);
  });

  it('is not stopped by one unreadable record', async () => {
    // A partial write, an eviction artefact, anything. Throwing here would leave every
    // session of this player alive after a password change — which is when this is called.
    const victim = await register();
    await harness.redis.set('session:not-a-real-session', 'not json', 'EX', 60);

    const removed = await sessions.destroyAllFor(victim.userId);
    expect(removed).toBeGreaterThanOrEqual(1);
    expect((await victim.client.get('/api/me', { cookie: victim.cookie })).status).toBe(401);

    // And the unreadable key is left for its own TTL rather than attributed to anyone.
    expect(await harness.redis.get('session:not-a-real-session')).toBe('not json');
    await harness.redis.del('session:not-a-real-session');
  });
});

describe('cookieOptions', () => {
  it('describes a cookie the browser will not send cross-site', () => {
    const options = sessions.cookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(86_400 * 1000);
  });

  it('leaves Secure off in the test environment, where there is no TLS', () => {
    // Production turns it on; this is the escape hatch that lets a VPS be reached by IP.
    expect(sessions.cookieOptions().secure).toBe(false);
  });
});

describe('the guard behind it', () => {
  it('refuses every authenticated route with no cookie', async () => {
    const client = new Client(harness.baseUrl);
    for (const path of ['/api/me', '/api/missions', '/api/labs/active']) {
      expect((await client.get(path)).status, path).toBe(401);
    }
  });

  it('signs out a session whose account is gone, rather than failing', async () => {
    // A valid session for a deleted account used to throw out of Prisma as a 500, which the
    // client cannot act on — it retries forever against a dashboard it can never load.
    const token = await sessions.create('00000000-0000-4000-8000-000000000000');
    const client = new Client(harness.baseUrl);

    const response = await client.get('/api/me', { cookie: `zr_session=${token}` });
    expect(response.status).toBe(401);

    // And the dead session is revoked on the way out.
    expect(await sessions.resolve(token)).toBeNull();
  });
});
