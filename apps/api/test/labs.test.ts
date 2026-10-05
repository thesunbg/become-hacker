import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { Client, TerminalClient, sleep, startHarness, type Harness } from './harness';

/**
 * The lab session's whole life: open, resume, expire, close.
 *
 * One live lab per player is a security limit, not a convenience — a second lab is a second
 * unaudited machine. The limit is also the single most dangerous thing in the game to get
 * wrong, because every failure mode strands the player: a lab the API thinks is running
 * refuses every new one, and nothing in the interface can clear it. That happened, so the
 * states that caused it are tested here one by one.
 */

let harness: Harness;

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
    email: `lab-${id}@example.test`,
    username: `lab_${id}`,
    password: 'a-long-enough-password',
  });
  expect(response.status).toBe(201);
  return client;
}

/** Completes mission 01 so mission 02 is unlocked, through the real event path. */
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

describe('opening a lab', () => {
  it('reports no lab before the player has opened one', async () => {
    const client = await register();
    const response = await client.get('/api/labs/active');
    expect(response.status).toBe(200);
    // Wrapped, not bare: a null body is indistinguishable from a failed request.
    expect(response.raw).not.toBe('');
    expect(response.body).toEqual({ lab: null });
  });

  it('asks the lab manager for the image the mission declares', async () => {
    const client = await register();
    const before = harness.labManager.created.length;
    await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(harness.labManager.created[before]).toMatchObject({
      image: 'linux-basic',
      missionId: 'ch01-mission-001',
    });
  });

  it('records the mission as started, so it is timed from the moment the lab opens', async () => {
    const client = await register();
    await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    const detail = await client.get('/api/missions/ch01-mission-001');
    expect(detail.body.progress.state).not.toBe('AVAILABLE');
    expect(detail.body.progress.attempts).toBeGreaterThanOrEqual(1);
  });

  it('rejects a mission id that is not one, before reaching the lab manager', async () => {
    const client = await register();
    const before = harness.labManager.created.length;
    for (const missionId of ['../../etc/passwd', 'ch1-mission-1', '', 'ch01-mission-0001']) {
      const response = await client.post('/api/labs', { missionId });
      expect(response.status).toBe(400);
    }
    expect(harness.labManager.created).toHaveLength(before);
  });

  it('answers 503 when the container runtime is unavailable, rather than pretending', async () => {
    const client = await register();
    harness.labManager.available = false;
    try {
      const response = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
      expect(response.status).toBe(503);
      // Nothing was written, so the player is not left holding a session with no container.
      expect((await client.get('/api/labs/active')).body).toEqual({ lab: null });
    } finally {
      harness.labManager.available = true;
    }
  });

  it('lets the player open a lab after a failed attempt', async () => {
    const client = await register();
    harness.labManager.available = false;
    await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    harness.labManager.available = true;

    const response = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(response.status).toBe(201);
  });
});

describe('the one-lab limit', () => {
  it('returns the same session when the player walks back into the lab they have', async () => {
    const client = await register();
    const first = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    const created = harness.labManager.created.length;

    const second = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(second.status).toBe(201);
    expect(second.body.sessionId).toBe(first.body.sessionId);
    // No second container: walking back in is not starting another lab.
    expect(harness.labManager.created).toHaveLength(created);
  });

  it('keeps the terminal path stable across a re-entry, so an open socket stays valid', async () => {
    const client = await register();
    const first = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    const terminal = await TerminalClient.connect(
      harness.baseUrl,
      first.body.sessionId,
      client.cookie,
    );

    const again = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(again.body.terminalPath).toBe(first.body.terminalPath);

    await terminal.type('whoami');
    expect(terminal.output).toContain('player');
    await terminal.close();
  });

  it('refuses a lab for another mission and names the one in the way', async () => {
    const client = await register();
    await completeMissionOne(client);
    await client.post('/api/labs', { missionId: 'ch01-mission-001' });

    const response = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
    expect(response.status).toBe(409);
    expect(response.body.activeMissionId).toBe('ch01-mission-001');
    expect(response.body.activeSessionId).toBeTruthy();
  });

  it('offers the player a way back to whatever they left open', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });

    const active = await client.get('/api/labs/active');
    expect(active.body.lab.sessionId).toBe(lab.body.sessionId);
    expect(active.body.lab.missionId).toBe('ch01-mission-001');
    expect(active.body.lab.terminalPath).toContain(lab.body.sessionId);
  });

  it('lets the player close it and then open the other one', async () => {
    const client = await register();
    await completeMissionOne(client);
    const first = await client.post('/api/labs', { missionId: 'ch01-mission-001' });

    const closed = await client.delete(`/api/labs/${first.body.sessionId}`);
    expect(closed.status).toBe(204);
    expect(harness.labManager.destroyed.length).toBeGreaterThan(0);

    const second = await client.post('/api/labs', { missionId: 'ch01-mission-002' });
    expect(second.status).toBe(201);
    expect(second.body.sessionId).not.toBe(first.body.sessionId);
  });
});

describe('a lab whose time has run out', () => {
  it('never locks the player out, even though nothing tells the API it died', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });

    // The lab manager destroys the container on its own timer and does not call back. This
    // is the state that stranded a player: an ACTIVE row with no container behind it.
    await harness.prisma.labSession.update({
      where: { id: lab.body.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    expect((await client.get('/api/labs/active')).body).toEqual({ lab: null });

    const fresh = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect(fresh.status).toBe(201);
    expect(fresh.body.sessionId).not.toBe(lab.body.sessionId);
  });

  it('marks the stale row EXPIRED rather than leaving it ACTIVE', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    await harness.prisma.labSession.update({
      where: { id: lab.body.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await client.get('/api/labs/active');

    const row = await harness.prisma.labSession.findUnique({ where: { id: lab.body.sessionId } });
    expect(row?.status).toBe('EXPIRED');
    expect(row?.endedAt).not.toBeNull();
    // The container id is dropped with it, so nothing tries to attach to a dead container.
    expect(row?.labId).toBeNull();
  });

  it('refuses a terminal attach to an expired session', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    await harness.prisma.labSession.update({
      where: { id: lab.body.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await client.get('/api/labs/active'); // sweeps it

    await expect(
      TerminalClient.connect(harness.baseUrl, lab.body.sessionId, client.cookie),
    ).rejects.toThrow();
  });

  it('expires one player session without touching another player', async () => {
    const mine = await register();
    const theirs = await register();
    const stale = await mine.post('/api/labs', { missionId: 'ch01-mission-001' });
    const live = await theirs.post('/api/labs', { missionId: 'ch01-mission-001' });

    await harness.prisma.labSession.update({
      where: { id: stale.body.sessionId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    await mine.get('/api/labs/active');

    const other = await harness.prisma.labSession.findUnique({
      where: { id: live.body.sessionId },
    });
    expect(other?.status).toBe('ACTIVE');
  });
});

describe('closing a lab', () => {
  it('records an abandoned attempt when the mission was not finished', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    await client.delete(`/api/labs/${lab.body.sessionId}`);

    const me = await client.get('/api/me');
    const events = await harness.prisma.labEvent.findMany({
      where: { userId: me.body.id, type: 'MISSION_ABANDONED' },
    });
    expect(events.length).toBe(1);
  });

  it('records nothing abandoned when the mission was already complete', async () => {
    const client = await register();
    await completeMissionOne(client);

    const me = await client.get('/api/me');
    const events = await harness.prisma.labEvent.findMany({
      where: { userId: me.body.id, type: 'MISSION_ABANDONED' },
    });
    expect(events).toHaveLength(0);
  });

  it('keeps a completed mission completed after the lab is closed', async () => {
    const client = await register();
    await completeMissionOne(client);
    const detail = await client.get('/api/missions/ch01-mission-001');
    expect(detail.body.progress.state).toBe('COMPLETED');
  });

  it('is not repeatable: a closed session is gone', async () => {
    const client = await register();
    const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
    expect((await client.delete(`/api/labs/${lab.body.sessionId}`)).status).toBe(204);

    // Still 204: the row survives as ENDED, and closing it again changes nothing. What must
    // not happen is a second container teardown or a second abandoned event.
    const destroyed = harness.labManager.destroyed.length;
    await client.delete(`/api/labs/${lab.body.sessionId}`);
    expect(harness.labManager.destroyed).toHaveLength(destroyed);
  });

  it('answers 404 for a session that never existed', async () => {
    const client = await register();
    const response = await client.delete('/api/labs/00000000-0000-4000-8000-000000000000');
    expect(response.status).toBe(404);
  });
});

describe('a lab belongs to one player', () => {
  it('refuses to close someone else lab, and does not destroy its container', async () => {
    const mine = await register();
    const theirs = await register();
    const lab = await mine.post('/api/labs', { missionId: 'ch01-mission-001' });

    const destroyed = harness.labManager.destroyed.length;
    const response = await theirs.delete(`/api/labs/${lab.body.sessionId}`);
    expect(response.status).toBe(404);
    expect(harness.labManager.destroyed).toHaveLength(destroyed);

    // And mine is still there.
    expect((await mine.get('/api/labs/active')).body.lab.sessionId).toBe(lab.body.sessionId);
  });

  it('refuses a terminal attach for someone else lab', async () => {
    const mine = await register();
    const theirs = await register();
    const lab = await mine.post('/api/labs', { missionId: 'ch01-mission-001' });

    await expect(
      TerminalClient.connect(harness.baseUrl, lab.body.sessionId, theirs.cookie),
    ).rejects.toThrow();
  });

  it('refuses a terminal attach with a forged session cookie', async () => {
    const mine = await register();
    const lab = await mine.post('/api/labs', { missionId: 'ch01-mission-001' });

    await expect(
      TerminalClient.connect(harness.baseUrl, lab.body.sessionId, 'zr_session=not-a-real-token'),
    ).rejects.toThrow();
  });

  it('refuses a terminal attach with no session id at all', async () => {
    const mine = await register();
    await mine.post('/api/labs', { missionId: 'ch01-mission-001' });

    const socket = new WebSocket(`${harness.baseUrl.replace(/^http/, 'ws')}/ws/terminal`, {
      headers: { cookie: mine.cookie },
    });
    const outcome = await new Promise<string>((resolve) => {
      socket.once('open', () => resolve('open'));
      socket.once('error', () => resolve('refused'));
      socket.once('unexpected-response', () => resolve('refused'));
    });
    socket.close();
    expect(outcome).toBe('refused');
  });

  it('leaves an unrelated path alone, so the SPA still loads', async () => {
    const response = await fetch(`${harness.baseUrl}/ws/something-else`);
    expect(response.status).toBeGreaterThanOrEqual(400);
    await response.text();
  });
});

describe('two labs at once', () => {
  it('lets two different players each hold their own', async () => {
    const one = await register();
    const two = await register();

    const first = await one.post('/api/labs', { missionId: 'ch01-mission-001' });
    const second = await two.post('/api/labs', { missionId: 'ch01-mission-001' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.sessionId).not.toBe(second.body.sessionId);

    // And neither can see the other.
    expect((await one.get('/api/labs/active')).body.lab.sessionId).toBe(first.body.sessionId);
    expect((await two.get('/api/labs/active')).body.lab.sessionId).toBe(second.body.sessionId);
  });

  it('keeps two attached terminals apart', async () => {
    const one = await register();
    const two = await register();
    const first = await one.post('/api/labs', { missionId: 'ch01-mission-001' });
    const second = await two.post('/api/labs', { missionId: 'ch01-mission-001' });

    const terminalOne = await TerminalClient.connect(
      harness.baseUrl,
      first.body.sessionId,
      one.cookie,
    );
    const terminalTwo = await TerminalClient.connect(
      harness.baseUrl,
      second.body.sessionId,
      two.cookie,
    );

    await terminalOne.type('cd .null');
    await terminalTwo.type('pwd');

    // Player two never left home; player one's cd must not have moved them.
    expect(terminalTwo.output).toContain('/home/player');
    expect(terminalTwo.output).not.toContain('.null');

    await terminalOne.close();
    await terminalTwo.close();
    await sleep(100);
  });
});
