import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, TerminalClient, startHarness, type Harness } from './harness';

/**
 * The vertical slice, end to end, against real Postgres and real Redis.
 *
 * Register -> login -> dashboard -> mission 01 -> lab -> terminal -> find the hidden file ->
 * submit the flag -> server validates -> mission complete -> XP. Everything upstream of the
 * container is the production code path; only the container itself is simulated, because
 * this machine has no Docker daemon.
 */

let harness: Harness;
let client: Client;

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
  client = new Client(harness.baseUrl);
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function register(): Promise<Client> {
  const fresh = new Client(harness.baseUrl);
  const id = unique();
  const response = await fresh.post('/api/auth/register', {
    email: `player-${id}@example.test`,
    username: `player_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  return fresh;
}

describe('the first ten minutes', () => {
  it('registers a new player and signs them in', async () => {
    const response = await client.post('/api/auth/register', {
      email: 'newcomer@example.test',
      username: 'newcomer',
      password: 'a-long-enough-password',
    });
    expect(response.status).toBe(201);
    expect(client.cookie).toContain('zr_session=');

    const me = await client.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.username).toBe('newcomer');
    expect(me.body.xp).toBe(0);
    expect(me.body.level).toBe(1);
  });

  it('shows mission 01 available and mission 02 locked behind it', async () => {
    const response = await client.get('/api/missions');
    expect(response.status).toBe(200);

    const byId = Object.fromEntries(response.body.missions.map((m: any) => [m.id, m]));
    expect(byId['ch01-mission-001'].state).toBe('AVAILABLE');
    expect(byId['ch01-mission-002'].state).toBe('LOCKED');
  });

  it('withholds a locked mission briefing, because the story is part of the reward', async () => {
    const response = await client.get('/api/missions/ch01-mission-002');
    expect(response.body.mission.state).toBe('LOCKED');
    expect(response.body.mission.story).toBe('');
    expect(response.body.mission.objective).toBe('');
    expect(response.body.mission.title).toBe('Find the Secret');
  });

  it('refuses a lab for a locked mission, so the gate is not only in the UI', async () => {
    const response = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
    expect(response.status).toBe(404);
    expect(harness.labManager.created).toHaveLength(0);
  });

  it('plays mission 01 through a real terminal and awards XP', async () => {
    const start = await client.post('/api/missions/ch01-mission-001/start');
    expect(start.status).toBe(201);
    expect(start.body.progress.state).toBe('STARTED');

    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(lab.status).toBe(201);
    expect(lab.body.terminalPath).toContain('/ws/terminal?sessionId=');
    expect(harness.labManager.created[0]).toMatchObject({ image: 'linux-basic' });

    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      client.cookie,
    );

    await terminal.type('whoami');
    expect(terminal.output).toContain('player');

    await terminal.type('pwd');
    expect(terminal.output).toContain('/home/player');

    await terminal.type('cat README.txt');
    expect(terminal.output).toContain('stop using it like a normal user');

    // One more command so the last one is certainly banked, then close.
    await terminal.type('ls');
    await terminal.close();

    const detail = await client.get('/api/missions/ch01-mission-001');
    expect(detail.body.progress.state).toBe('COMPLETED');
    expect(detail.body.progress.tasks.every((t: any) => t.completed)).toBe(true);

    const me = await client.get('/api/me');
    expect(me.body.xp).toBeGreaterThanOrEqual(100);
    expect(me.body.skills.find((s: any) => s.skill === 'LINUX')?.value).toBe(5);
  });

  it('reveals the knowledge review only once the mission is done', async () => {
    const detail = await client.get('/api/missions/ch01-mission-001');
    expect(detail.body.mission.knowledge.length).toBeGreaterThan(0);
    expect(detail.body.mission.knowledge[0].realWorld).toBeTruthy();

    const locked = await client.get('/api/missions/ch01-mission-002');
    expect(locked.body.mission.knowledge).toEqual([]);
  });

  it('unlocks mission 02 now that its prerequisite is complete', async () => {
    const response = await client.get('/api/missions');
    const mission = response.body.missions.find((m: any) => m.id === 'ch01-mission-002');
    expect(mission.state).toBe('AVAILABLE');
    expect(mission.story).toContain('normal user would never see it');
  });
});

describe('mission 02 — discovering the hidden file', () => {
  let player: Client;

  beforeAll(async () => {
    player = await register();
    // Complete mission 01 the quick way: the same event path, without the terminal.
    await player.post('/api/missions/ch01-mission-001/start');
    const lab = await player.post('/api/labs', { missionId: 'ch01-mission-001' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      player.cookie,
    );
    await terminal.type('whoami');
    await terminal.type('pwd');
    await terminal.type('cat README.txt');
    await terminal.close();
    await player.delete(`/api/labs/${lab.body.sessionId}`);
  }, 60_000);

  it('hides the secret from a default listing and reveals it to ls -la', async () => {
    const lab = await player.post('/api/labs', { missionId: 'ch01-mission-002' });
    expect(lab.status).toBe(201);

    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      player.cookie,
    );

    await terminal.type('ls');
    expect(terminal.output).not.toContain('.null');

    await terminal.type('ls -la');
    expect(terminal.output).toContain('.null');

    await terminal.type('cat .null/first_contact');
    expect(terminal.output).toContain('ZR{h1dd3n_1n_pl41n_s1ght}');
    expect(terminal.output).toContain('We are called NULL');

    await terminal.close();

    // Reading the file is not completing the mission: the flag still has to be submitted.
    const detail = await player.get('/api/missions/ch01-mission-002');
    expect(detail.body.progress.state).toBe('IN_PROGRESS');

    await player.delete(`/api/labs/${lab.body.sessionId}`);
  });

  it('rejects a wrong flag, counts it once, and still allows the right one', async () => {
    const wrong = await player.post('/api/missions/ch01-mission-002/flag', {
      value: 'ZR{a_guess}',
    });
    expect(wrong.status).toBe(201);
    expect(wrong.body.correct).toBe(false);
    expect(wrong.body.result).toBeNull();
    expect(wrong.body.progress.mistakes).toBe(1);
    expect(wrong.body.progress.state).not.toBe('COMPLETED');

    const right = await player.post('/api/missions/ch01-mission-002/flag', {
      value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
    });
    expect(right.body.correct).toBe(true);
    expect(right.body.progress.state).toBe('COMPLETED');
    expect(right.body.result.completed).toBe(true);
    expect(right.body.result.rating).toBeGreaterThan(0);
    expect(right.body.result.xpAwarded).toBeGreaterThan(0);
    expect(right.body.result.mistakes).toBe(1);
  });

  it('pays the mission XP exactly once, however many times the flag is submitted', async () => {
    const before = (await player.get('/api/me')).body.xp;

    for (let i = 0; i < 3; i++) {
      await player.post('/api/missions/ch01-mission-002/flag', {
        value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
      });
    }

    expect((await player.get('/api/me')).body.xp).toBe(before);

    const ledger = await harness.prisma.xpTransaction.findMany({
      where: { reason: 'mission.completed', missionId: 'ch01-mission-002' },
    });
    expect(ledger).toHaveLength(1);
  });

  it('derives the XP total from the ledger rather than a stored counter', async () => {
    const me = await player.get('/api/me');
    const rows = await harness.prisma.xpTransaction.aggregate({
      where: { userId: me.body.id },
      _sum: { amount: true },
    });
    expect(me.body.xp).toBe(rows._sum.amount);
  });
});

describe('hints', () => {
  let player: Client;

  beforeAll(async () => {
    player = await register();
  });

  it('hands out hints in order and will not skip to the syntax', async () => {
    const first = await player.post('/api/missions/ch01-mission-001/hint');
    expect(first.body.level).toBe(1);
    expect(first.body.text).toContain('?');
    expect(first.body.xpCost).toBe(5);

    const second = await player.post('/api/missions/ch01-mission-001/hint');
    expect(second.body.level).toBe(2);
    expect(second.body.xpCost).toBeGreaterThanOrEqual(first.body.xpCost);

    const third = await player.post('/api/missions/ch01-mission-001/hint');
    expect(third.body.level).toBe(3);

    const none = await player.post('/api/missions/ch01-mission-001/hint');
    expect(none.status).toBe(400);
  });

  it('returns the revealed hints with the mission, and only those', async () => {
    const detail = await player.get('/api/missions/ch01-mission-001');
    expect(detail.body.revealedHints.map((h: any) => h.level)).toEqual([1, 2, 3]);
    expect(detail.body.mission.hints.every((h: any) => h.revealed)).toBe(true);
  });

  it('charges the hints once, at completion, through the engine', async () => {
    const lab = await player.post('/api/labs', { missionId: 'ch01-mission-001' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      player.cookie,
    );
    await terminal.type('whoami');
    await terminal.type('pwd');
    await terminal.type('cat README.txt');
    await terminal.type('ls');
    await terminal.close();

    const me = await player.get('/api/me');
    const hinted = me.body.xp;

    // Base 100 + task XP 100 + first-attempt bonus, less the 35 XP of hints bought, and no
    // no-hint bonus. The exact number is the engine's business; what matters here is that
    // buying hints cost XP and that the player still finished in credit.
    expect(hinted).toBeGreaterThan(0);
    expect(hinted).toBeLessThan(235);
  });
});

describe('a player who has not signed in', () => {
  const anonymous = () => new Client(harness.baseUrl);

  it('cannot read their profile', async () => {
    expect((await anonymous().get('/api/me')).status).toBe(401);
  });

  it('cannot list missions', async () => {
    expect((await anonymous().get('/api/missions')).status).toBe(401);
  });

  it('cannot start a lab', async () => {
    const response = await anonymous().post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(response.status).toBe(401);
  });

  it('cannot submit a flag', async () => {
    const response = await anonymous().post('/api/missions/ch01-mission-002/flag', {
      value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
    });
    expect(response.status).toBe(401);
  });

  it('is rejected by a forged session cookie', async () => {
    const forged = anonymous();
    forged.cookie = 'zr_session=made-up-id.made-up-signature';
    expect((await forged.get('/api/me')).status).toBe(401);
  });

  it('is rejected by a cookie whose signature does not match its id', async () => {
    const player = await register();
    const [name, value] = player.cookie.split('=') as [string, string];
    const [id] = value.split('.') as [string];
    const tampered = anonymous();
    tampered.cookie = `${name}=${id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    expect((await tampered.get('/api/me')).status).toBe(401);
  });

  it('loses access the moment they sign out', async () => {
    const player = await register();
    expect((await player.get('/api/me')).status).toBe(200);
    expect((await player.post('/api/auth/logout')).status).toBe(204);
    expect((await player.get('/api/me')).status).toBe(401);
  });
});
