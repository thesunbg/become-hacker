import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEVEL_BASE_XP, levelForXp, xpForLevel } from '@zero-root/shared';
import { Client, TerminalClient, startHarness, type Harness } from './harness';

/**
 * XP as an append-only ledger (CLAUDE.md rule 5).
 *
 * "Never store `user.xp = 1000`" is the rule; what makes it worth having is that every total
 * can be explained by the rows that produced it, and a double-award shows up as two rows
 * rather than as a number nobody can account for. So these tests read the ledger directly
 * and check that the total the player is shown is a SUM over it — and that there is no column
 * anywhere holding a balance that could drift from those rows.
 */

let harness: Harness;

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function register(): Promise<{ client: Client; userId: string }> {
  const client = new Client(harness.baseUrl);
  const id = unique();
  const response = await client.post('/api/auth/register', {
    email: `xp-${id}@example.test`,
    username: `xp_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  return { client, userId: (await client.get('/api/me')).body.id };
}

/** Plays mission 01 to completion through the real terminal. */
async function completeMissionOne(client: Client): Promise<void> {
  await client.post('/api/missions/ch01-mission-001/start');
  const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
  const terminal = await TerminalClient.connect(harness.baseUrl, lab.body.sessionId, client.cookie);
  await terminal.type('whoami');
  await terminal.type('pwd');
  await terminal.type('cat README.txt');
  await terminal.close();
  await client.delete(`/api/labs/${lab.body.sessionId}`);
}

/** Mission 01 as authored, so the expected rewards come from the content, not a copy of it. */
const missionOne = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../content/chapters/01-computer/mission-001.json',
    ),
    'utf8',
  ),
) as { skills: { skill: string; amount: number }[] };

const ledger = (userId: string) =>
  harness.prisma.xpTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });

describe('a new player', () => {
  it('has an empty ledger and no XP', async () => {
    const { client, userId } = await register();
    expect(await ledger(userId)).toEqual([]);
    expect((await client.get('/api/me')).body.xp).toBe(0);
    expect((await client.get('/api/me')).body.level).toBe(1);
  });
});

describe('completing a mission', () => {
  it('appends exactly one row, with a reason', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);

    const rows = await ledger(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.reason).toBe('mission.completed');
    expect(rows[0]?.missionId).toBe('ch01-mission-001');
    expect(rows[0]?.amount).toBeGreaterThan(0);
  });

  it('shows a total that is the sum of the rows, not a stored number', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);

    const rows = await ledger(userId);
    const sum = rows.reduce((total, row) => total + row.amount, 0);
    expect((await client.get('/api/me')).body.xp).toBe(sum);
  });

  it('derives the level from that total', async () => {
    const { client } = await register();
    await completeMissionOne(client);

    const me = await client.get('/api/me');
    expect(me.body.level).toBe(levelForXp(me.body.xp));
  });

  it('awards exactly the skills the mission declares', async () => {
    const { client } = await register();
    await completeMissionOne(client);

    const skills = (await client.get('/api/me')).body.skills as { skill: string; value: number }[];
    expect([...skills].sort((a, b) => a.skill.localeCompare(b.skill))).toEqual(
      [...missionOne.skills]
        .map((reward) => ({ skill: reward.skill, value: reward.amount }))
        .sort((a, b) => a.skill.localeCompare(b.skill)),
    );
  });

  it('awards them once, not again on a replay', async () => {
    const { client } = await register();
    await completeMissionOne(client);
    const first = (await client.get('/api/me')).body.skills;

    await completeMissionOne(client);
    expect((await client.get('/api/me')).body.skills).toEqual(first);
  });
});

describe('XP is paid once', () => {
  it('does not pay again when the mission is replayed', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);
    const after = await ledger(userId);

    // Walk the whole mission a second time: new lab, same commands, same objectives.
    await completeMissionOne(client);

    expect(await ledger(userId)).toHaveLength(after.length);
    expect((await client.get('/api/me')).body.xp).toBe(
      after.reduce((total, row) => total + row.amount, 0),
    );
  });

  it('does not pay again when progress is re-synced by another request', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);
    const before = await ledger(userId);

    // Every one of these re-evaluates progress server-side.
    for (let attempt = 0; attempt < 5; attempt++) {
      await client.get('/api/missions/ch01-mission-001');
      await client.get('/api/missions');
      await client.post('/api/missions/ch01-mission-001/start');
    }

    expect(await ledger(userId)).toHaveLength(before.length);
  });

  it('does not pay again for a repeated correct flag', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);

    // Mission 02 is the one with a flag.
    await client.post('/api/missions/ch01-mission-002/start');
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      client.cookie,
    );
    await terminal.type('ls -la');
    await terminal.type('cat .null/first_contact');
    await terminal.close();

    const first = await client.post('/api/missions/ch01-mission-002/flag', {
      value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
    });
    expect(first.body.correct).toBe(true);
    const afterFirst = await ledger(userId);

    for (let attempt = 0; attempt < 3; attempt++) {
      await client.post('/api/missions/ch01-mission-002/flag', {
        value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
      });
    }

    expect(await ledger(userId)).toHaveLength(afterFirst.length);
  });

  it('keeps one row per mission, so a total can always be explained', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);

    await client.post('/api/missions/ch01-mission-002/start');
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      lab.body.sessionId,
      client.cookie,
    );
    await terminal.type('ls -la');
    await terminal.type('cat .null/first_contact');
    await terminal.close();
    await client.post('/api/missions/ch01-mission-002/flag', {
      value: 'ZR{h1dd3n_1n_pl41n_s1ght}',
    });

    const rows = await ledger(userId);
    expect(rows.map((row) => row.missionId)).toEqual(['ch01-mission-001', 'ch01-mission-002']);
    expect((await client.get('/api/me')).body.xp).toBe(
      rows.reduce((total, row) => total + row.amount, 0),
    );
  });
});

describe('hints are charged through the ledger, not deducted from a balance', () => {
  it('costs nothing until the mission is scored', async () => {
    const { client, userId } = await register();
    await client.post('/api/missions/ch01-mission-001/start');

    const hint = await client.post('/api/missions/ch01-mission-001/hint');
    expect(hint.status).toBe(201);
    expect(hint.body.xpCost).toBeGreaterThan(0);

    // No negative row, and no total below zero: a player who buys hints without finishing
    // must not go into debt.
    expect(await ledger(userId)).toEqual([]);
    expect((await client.get('/api/me')).body.xp).toBe(0);
  });

  it('is reflected in the single row paid at completion', async () => {
    const withHints = await register();
    const without = await register();

    await withHints.client.post('/api/missions/ch01-mission-001/start');
    await withHints.client.post('/api/missions/ch01-mission-001/hint');
    await withHints.client.post('/api/missions/ch01-mission-001/hint');
    await completeMissionOne(withHints.client);
    await completeMissionOne(without.client);

    const paidWithHints = (await ledger(withHints.userId))[0]?.amount ?? 0;
    const paidWithout = (await ledger(without.userId))[0]?.amount ?? 0;

    expect(paidWithHints).toBeLessThan(paidWithout);
    expect(await ledger(withHints.userId)).toHaveLength(1);
  });

  it('never pays less than nothing, however many hints were bought', async () => {
    const { client, userId } = await register();
    await client.post('/api/missions/ch01-mission-001/start');
    for (let level = 0; level < 5; level++) {
      await client.post('/api/missions/ch01-mission-001/hint');
    }
    await completeMissionOne(client);

    const rows = await ledger(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.amount).toBeGreaterThan(0);
  });
});

describe('the ledger is the only authority', () => {
  it('ignores a tampered score on the materialised row', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);
    const paid = (await ledger(userId))[0]?.amount ?? 0;

    // The UserMission row is a view of a computation, not a source of truth.
    await harness.prisma.userMission.update({
      where: { userId_missionId: { userId, missionId: 'ch01-mission-001' } },
      data: { bestScore: 1000, bestRating: 5 },
    });
    await client.get('/api/missions/ch01-mission-001');

    expect((await ledger(userId)).map((row) => row.amount)).toEqual([paid]);
  });

  it('recomputes the total from the rows that remain when one is removed', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);
    expect((await client.get('/api/me')).body.xp).toBeGreaterThan(0);

    // Not something the application does — the point is that the total follows the rows.
    await harness.prisma.xpTransaction.deleteMany({ where: { userId } });
    expect((await client.get('/api/me')).body.xp).toBe(0);
    expect((await client.get('/api/me')).body.level).toBe(1);
  });

  it('stores no XP balance on the user, so there is nothing to drift', async () => {
    const { client, userId } = await register();
    await completeMissionOne(client);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const profile = await harness.prisma.profile.findUnique({ where: { userId } });
    for (const row of [
      user as Record<string, unknown>,
      (profile ?? {}) as Record<string, unknown>,
    ]) {
      for (const key of Object.keys(row)) {
        expect(key.toLowerCase(), `${key} looks like a stored balance`).not.toBe('xp');
        expect(key.toLowerCase()).not.toBe('level');
      }
    }
    expect((await client.get('/api/me')).body.xp).toBeGreaterThan(0);
  });
});

describe('the level curve is the shared one', () => {
  it('agrees with the package the web client draws its bar from', async () => {
    const { client } = await register();
    await completeMissionOne(client);
    const me = await client.get('/api/me');

    expect(me.body.level).toBe(levelForXp(me.body.xp));
    expect(me.body.xp).toBeGreaterThanOrEqual(xpForLevel(me.body.level));
    expect(me.body.xp).toBeLessThan(xpForLevel(me.body.level + 1));
  });

  it('leaves level 1 free and puts the first level-up one base cost away', () => {
    expect(xpForLevel(1)).toBe(0);
    expect(levelForXp(LEVEL_BASE_XP - 1)).toBe(1);
    expect(levelForXp(LEVEL_BASE_XP)).toBe(2);
  });
});
