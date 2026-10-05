import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, TerminalClient, WEB_ORIGIN, startHarness, type Harness } from './harness';

/**
 * The properties that make the game worth playing: the server decides, and the client is
 * never believed. Each of these is a rule from CLAUDE.md or docs/06-security.md, asserted
 * against the running API.
 */

let harness: Harness;
const FLAG_002 = 'ZR{h1dd3n_1n_pl41n_s1ght}';

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function register(): Promise<Client> {
  const client = new Client(harness.baseUrl);
  const id = unique();
  const response = await client.post('/api/auth/register', {
    email: `anti-${id}@example.test`,
    username: `anti_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  return client;
}

/** Completes mission 01, which is how mission 02 gets unlocked. */
async function completeMissionOne(client: Client): Promise<void> {
  await client.post('/api/missions/ch01-mission-001/start');
  const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
  const terminal = await TerminalClient.connect(harness.baseUrl, lab.body.sessionId, client.cookie);
  await terminal.type('whoami');
  await terminal.type('pwd');
  await terminal.type('cat README.txt');
  await terminal.type('ls');
  await terminal.close();
  await client.delete(`/api/labs/${lab.body.sessionId}`);
}

/**
 * Works through mission 02's objectives, stopping short of the flag.
 *
 * The flag alone cannot complete it — the mission also requires the listing and the read —
 * which is itself the point: completion is the engine's verdict on the whole event stream,
 * not a reward for knowing one string.
 */
async function reachMissionTwoFlag(client: Client): Promise<void> {
  const lab = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
  const terminal = await TerminalClient.connect(harness.baseUrl, lab.body.sessionId, client.cookie);
  await terminal.type('ls -la');
  await terminal.type('cat .null/first_contact');
  await terminal.type('pwd');
  await terminal.close();
  await client.delete(`/api/labs/${lab.body.sessionId}`);
}

describe('flags never reach the client', () => {
  let player: Client;

  beforeAll(async () => {
    player = await register();
    await completeMissionOne(player);
  }, 60_000);

  it('is absent from the mission list', async () => {
    const response = await player.get('/api/missions');
    expect(response.raw).not.toContain(FLAG_002);
    expect(response.raw).not.toContain('h1dd3n');
    expect(response.raw).not.toContain('"flag"');
  });

  it('is absent from a mission detail, before and after completion', async () => {
    const before = await player.get('/api/missions/ch01-mission-002');
    expect(before.raw).not.toContain('h1dd3n');

    await reachMissionTwoFlag(player);
    await player.post('/api/missions/ch01-mission-002/flag', { value: FLAG_002 });

    const after = await player.get('/api/missions/ch01-mission-002');
    expect(after.body.mission.state).toBe('COMPLETED');
    expect(after.raw).not.toContain('h1dd3n');
  });

  it('cannot be completed by the flag alone, without doing the mission', async () => {
    const shortcut = await register();
    await completeMissionOne(shortcut);

    const response = await shortcut.post('/api/missions/ch01-mission-002/flag', {
      value: FLAG_002,
    });
    expect(response.body.correct).toBe(true);
    // Knowing the flag is not the same as having discovered it.
    expect(response.body.progress.state).toBe('IN_PROGRESS');
    expect(response.body.result).toBeNull();

    const me = await shortcut.get('/api/me');
    const ledger = await harness.prisma.xpTransaction.findMany({
      where: { userId: me.body.id, missionId: 'ch01-mission-002' },
    });
    expect(ledger).toHaveLength(0);
  });

  it('is absent from the progress response', async () => {
    const response = await player.get('/api/me/progress');
    expect(response.raw).not.toContain('h1dd3n');
  });

  it('is not stored in the database at all', async () => {
    const missions = await harness.prisma.mission.findMany();
    expect(JSON.stringify(missions)).not.toContain('h1dd3n');

    // The event stream records only the verdict of a comparison, never the value compared.
    const events = await harness.prisma.labEvent.findMany({ where: { type: 'FLAG_SUBMITTED' } });
    expect(events.length).toBeGreaterThan(0);
    expect(JSON.stringify(events)).not.toContain('h1dd3n');
    expect(events.every((event) => 'correct' in (event.payload as object))).toBe(true);
  });

  it('withholds task targets, which for a FILE_FOUND objective are the solution', async () => {
    const response = await player.get('/api/missions/ch01-mission-002');
    expect(response.raw).not.toContain('.null/first_contact');
    expect(response.body.mission.tasks.every((task: any) => !('target' in task))).toBe(true);
  });

  it('withholds the text of hints the player has not bought', async () => {
    const response = await player.get('/api/missions/ch01-mission-001');
    expect(response.body.revealedHints).toEqual([]);
    expect(response.body.mission.hints.every((hint: any) => !hint.revealed)).toBe(true);
    // Level 3 of mission 001 is the one that gives the commands away.
    expect(response.raw).not.toContain('whoami` to see your username');
  });
});

describe('progress cannot be asserted by the client', () => {
  let player: Client;

  beforeAll(async () => {
    player = await register();
  });

  it('has no endpoint that accepts a score', async () => {
    for (const path of [
      '/api/missions/ch01-mission-001/complete',
      '/api/mission/complete',
      '/api/me/xp',
    ]) {
      const response = await player.post(path, { score: 1000, xp: 99999 });
      expect([404, 400]).toContain(response.status);
    }
  });

  it('rejects extra fields smuggled into a flag submission', async () => {
    const response = await player.post('/api/missions/ch01-mission-001/flag', {
      value: 'guess',
      score: 1000,
      xpAwarded: 99999,
      completed: true,
    });
    expect(response.status).toBe(400);
  });

  it('rejects a mission id that is not a mission id', async () => {
    const response = await player.post('/api/labs', { missionId: '../../etc/passwd' });
    expect(response.status).toBe(400);
  });

  it('awards no XP for a wrong flag, however many times it is tried', async () => {
    await completeMissionOne(player);
    const before = (await player.get('/api/me')).body.xp;

    for (let i = 0; i < 5; i++) {
      await player.post('/api/missions/ch01-mission-002/flag', { value: `guess-${i}` });
    }

    expect((await player.get('/api/me')).body.xp).toBe(before);
  });

  it('recomputes progress from events, so a tampered row does not grant completion', async () => {
    const me = await player.get('/api/me');

    // Simulate a corrupted or hand-edited materialised row.
    await harness.prisma.userMission.updateMany({
      where: { userId: me.body.id, missionId: 'ch01-mission-002' },
      data: { state: 'COMPLETED', bestScore: 1000, bestRating: 5 },
    });

    // The engine replays the event stream and corrects it: the flag was never submitted.
    const detail = await player.get('/api/missions/ch01-mission-002');
    expect(detail.body.progress.state).not.toBe('COMPLETED');
    expect(detail.body.progress.flagAccepted).toBe(false);

    // And no XP was ever written for it.
    const ledger = await harness.prisma.xpTransaction.findMany({
      where: { userId: me.body.id, missionId: 'ch01-mission-002' },
    });
    expect(ledger).toHaveLength(0);
  });

  it('throttles flag guessing', async () => {
    const guesser = await register();
    await completeMissionOne(guesser);

    let throttled = false;
    for (let i = 0; i < 30; i++) {
      const response = await guesser.post('/api/missions/ch01-mission-002/flag', {
        value: `brute-${i}`,
      });
      if (response.status === 400 && String(response.body?.message).includes('Too many')) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });
});

describe('locked missions are closed off server-side', () => {
  let player: Client;

  beforeAll(async () => {
    player = await register();
  });

  it('refuses to start a locked mission', async () => {
    const response = await player.post('/api/missions/ch01-mission-002/start');
    expect(response.status).toBe(404);
  });

  it('refuses a lab for a locked mission', async () => {
    const response = await player.post('/api/labs', { missionId: 'ch01-mission-002' });
    expect(response.status).toBe(404);
  });

  it('refuses a hint for a locked mission', async () => {
    const response = await player.post('/api/missions/ch01-mission-002/hint');
    expect(response.status).toBe(404);
  });

  it('refuses the correct flag for a locked mission', async () => {
    const response = await player.post('/api/missions/ch01-mission-002/flag', { value: FLAG_002 });
    expect(response.status).toBe(404);

    const me = await player.get('/api/me');
    expect(me.body.xp).toBe(0);
  });
});

describe('one player cannot reach another player lab', () => {
  it('refuses a terminal attach for a lab owned by someone else', async () => {
    const owner = await register();
    const intruder = await register();

    const lab = await owner.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(lab.status).toBe(201);

    await expect(
      TerminalClient.connect(harness.baseUrl, lab.body.sessionId, intruder.cookie),
    ).rejects.toThrow(/404/);
  });

  it('refuses a terminal attach with no session cookie at all', async () => {
    const owner = await register();
    const lab = await owner.post('/api/labs', { missionId: 'ch01-mission-001' });

    await expect(TerminalClient.connect(harness.baseUrl, lab.body.sessionId, '')).rejects.toThrow(
      /401/,
    );
  });

  it('refuses to destroy a lab owned by someone else', async () => {
    const owner = await register();
    const intruder = await register();
    const lab = await owner.post('/api/labs', { missionId: 'ch01-mission-001' });

    expect((await intruder.delete(`/api/labs/${lab.body.sessionId}`)).status).toBe(404);
    expect((await owner.delete(`/api/labs/${lab.body.sessionId}`)).status).toBe(204);
  });

  it('allows only one live lab per player', async () => {
    const player = await register();
    expect((await player.post('/api/labs', { missionId: 'ch01-mission-001' })).status).toBe(201);

    const second = await player.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(second.status).toBe(400);
    expect(String(second.body.message)).toContain('already have a lab');
  });
});

describe('CSRF', () => {
  it('refuses a state-changing request from another origin', async () => {
    const player = await register();
    const response = await player.post('/api/missions/ch01-mission-001/start', undefined, {
      origin: 'https://evil.example',
    });
    expect(response.status).toBe(403);
  });

  it('refuses a state-changing request with no origin at all', async () => {
    const player = await register();
    const response = await player.post('/api/missions/ch01-mission-001/start', undefined, {
      origin: null,
    });
    expect(response.status).toBe(403);
  });

  it('allows a read from any origin, since reads change nothing', async () => {
    const player = await register();
    const response = await player.request('GET', '/api/me', undefined, {
      origin: 'https://somewhere.example',
    });
    expect(response.status).toBe(200);
  });

  it('allows the configured web origin', async () => {
    const player = await register();
    const response = await player.post('/api/missions/ch01-mission-001/start', undefined, {
      origin: WEB_ORIGIN,
    });
    expect(response.status).toBe(201);
  });
});

describe('credentials', () => {
  it('never returns a password hash', async () => {
    const player = await register();
    const response = await player.get('/api/me');
    expect(response.raw).not.toContain('passwordHash');
    expect(response.raw).not.toContain('$argon2');
  });

  it('stores the password as an argon2id hash, not as the password', async () => {
    const client = new Client(harness.baseUrl);
    const id = unique();
    const password = 'a-long-enough-password';
    await client.post('/api/auth/register', {
      email: `hash-${id}@example.test`,
      username: `hash_${id}`,
      password,
    });

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: `hash-${id}@example.test` },
    });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(password);
  });

  it('rejects a password short enough to be guessed', async () => {
    const client = new Client(harness.baseUrl);
    const response = await client.post('/api/auth/register', {
      email: `short-${unique()}@example.test`,
      username: `short_${unique()}`,
      password: 'short',
    });
    expect(response.status).toBe(400);
  });

  it('rejects a malformed email and an unusable username', async () => {
    const client = new Client(harness.baseUrl);
    expect(
      (
        await client.post('/api/auth/register', {
          email: 'not-an-email',
          username: 'fine_name',
          password: 'a-long-enough-password',
        })
      ).status,
    ).toBe(400);

    expect(
      (
        await client.post('/api/auth/register', {
          email: `ok-${unique()}@example.test`,
          username: 'has spaces',
          password: 'a-long-enough-password',
        })
      ).status,
    ).toBe(400);
  });

  it('gives the same answer whether the account exists or the password is wrong', async () => {
    const id = unique();
    const client = new Client(harness.baseUrl);
    await client.post('/api/auth/register', {
      email: `known-${id}@example.test`,
      username: `known_${id}`,
      password: 'a-long-enough-password',
    });

    const wrongPassword = await new Client(harness.baseUrl).post('/api/auth/login', {
      email: `known-${id}@example.test`,
      password: 'not-the-password',
    });
    const unknownAccount = await new Client(harness.baseUrl).post('/api/auth/login', {
      email: `nobody-${unique()}@example.test`,
      password: 'not-the-password',
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(wrongPassword.body.message).toBe(unknownAccount.body.message);
  });

  it('signs a returning player in with the right password', async () => {
    const id = unique();
    const client = new Client(harness.baseUrl);
    await client.post('/api/auth/register', {
      email: `return-${id}@example.test`,
      username: `return_${id}`,
      password: 'a-long-enough-password',
    });
    await client.post('/api/auth/logout');

    const login = await client.post('/api/auth/login', {
      email: `return-${id}@example.test`,
      password: 'a-long-enough-password',
    });
    expect(login.status).toBe(201);
    expect((await client.get('/api/me')).body.username).toBe(`return_${id}`);
  });

  it('throttles repeated failed sign-ins for one address', async () => {
    const id = unique();
    const email = `throttle-${id}@example.test`;
    const client = new Client(harness.baseUrl);
    await client.post('/api/auth/register', {
      email,
      username: `thr_${id}`,
      password: 'a-long-enough-password',
    });

    let throttled = false;
    for (let attempt = 0; attempt < 15; attempt++) {
      const response = await new Client(harness.baseUrl).post('/api/auth/login', {
        email,
        password: 'wrong-password-attempt',
      });
      if (response.status === 400 && String(response.body.message).includes('Too many')) {
        throttled = true;
        break;
      }
    }
    expect(throttled).toBe(true);
  });

  it('writes an audit trail for sign-in activity', async () => {
    const logs = await harness.prisma.auditLog.findMany({
      where: {
        action: {
          in: ['auth.register', 'auth.login', 'auth.login.failed', 'auth.login.throttled'],
        },
      },
    });
    expect(logs.length).toBeGreaterThan(0);
    expect(JSON.stringify(logs)).not.toContain('a-long-enough-password');
  });
});
