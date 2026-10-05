import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, TerminalClient, sleep, startHarness, type Harness } from './harness';

/**
 * The terminal byte stream, end to end, for the cases a simulated shell cannot produce.
 *
 * The gateway forwards whatever the container sends, in whatever chunks it arrives. That is
 * where the awkward input lives: a multi-byte character split across two frames, a binary
 * file's NUL bytes, a command that floods. Each of these reaches both the player's screen
 * and the recorded event stream, so each can break the game in two different ways.
 */

let harness: Harness;

const unique = () => Math.random().toString(36).slice(2, 10);

beforeAll(async () => {
  harness = await startHarness();
}, 60_000);

afterAll(async () => {
  await harness?.close();
});

async function playerInALab(): Promise<{
  client: Client;
  terminal: TerminalClient;
  sessionId: string;
}> {
  const client = new Client(harness.baseUrl);
  const id = unique();
  const registered = await client.post('/api/auth/register', {
    email: `stream-${id}@example.test`,
    username: `stream_${id}`,
    password: 'a-long-enough-password',
  });
  expect(registered.status).toBe(201);

  await client.post('/api/missions/ch01-mission-001/start');
  const lab = await client.post('/api/labs', { missionId: 'ch01-mission-001' });
  expect(lab.status).toBe(201);

  const terminal = await TerminalClient.connect(harness.baseUrl, lab.body.sessionId, client.cookie);
  // The attach prompt, so the recorder has seen a prompt before anything is typed.
  await sleep(100);
  return { client, terminal, sessionId: lab.body.sessionId };
}

/** The COMMAND_EXECUTED rows the server recorded for this player, oldest first. */
async function recordedCommands(client: Client): Promise<{ command: string; output: string }[]> {
  const me = await client.get('/api/me');
  const rows = await harness.prisma.labEvent.findMany({
    where: { userId: me.body.id, type: 'COMMAND_EXECUTED' },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.payload as { command: string; output: string });
}

describe('output split across frames', () => {
  it('keeps a multi-byte character intact when it is split down the middle', async () => {
    const { client, terminal } = await playerInALab();

    // Vietnamese, the game's second language: 'chào' is two bytes in the middle of a word,
    // 'người' three. A container writing in 4 KB chunks will split one of these sooner or
    // later, and the two halves arrive as separate WebSocket frames.
    const text = 'xin chào, người chơi\r\n';
    const bytes = Buffer.from(text, 'utf8');
    const cut = bytes.indexOf(Buffer.from('à', 'utf8')) + 1; // between the two bytes of à

    await terminal.submit('cat greeting.txt');
    harness.labManager.sendRaw(bytes.subarray(0, cut));
    await sleep(50);
    harness.labManager.sendRaw(bytes.subarray(cut));
    await sleep(700);

    expect(terminal.output).toContain('xin chào, người chơi');
    expect(terminal.output).not.toContain('�');

    await terminal.close();

    const recorded = await recordedCommands(client);
    const greeting = recorded.find((entry) => entry.command === 'cat greeting.txt');
    expect(greeting?.output).toContain('xin chào, người chơi');
    expect(greeting?.output).not.toContain('�');
  });

  it('keeps a flag intact when the split lands inside it', async () => {
    const { client, terminal } = await playerInALab();
    const bytes = Buffer.from('ZR{h1dd3n_1n_pl41n_s1ght}\r\n', 'utf8');

    await terminal.submit('cat .null/first_contact');
    for (let at = 0; at < bytes.length; at += 4) {
      harness.labManager.sendRaw(bytes.subarray(at, at + 4));
      await sleep(5);
    }
    await sleep(700);

    expect(terminal.output).toContain('ZR{h1dd3n_1n_pl41n_s1ght}');
    await terminal.close();

    const recorded = await recordedCommands(client);
    const read = recorded.find((entry) => entry.command === 'cat .null/first_contact');
    expect(read?.output).toContain('ZR{h1dd3n_1n_pl41n_s1ght}');
  });
});

describe('output a binary file would produce', () => {
  it('records the command despite NUL bytes, which PostgreSQL json cannot store', async () => {
    const { client, terminal } = await playerInALab();

    await terminal.submit('cat /bin/ls');
    harness.labManager.sendRaw(
      Buffer.from('\u0000\u0001ELF\u0000\u0002binary\u0000junk\r\n', 'utf8'),
    );
    await sleep(700);
    await terminal.close();

    // Before the control bytes were stripped the insert threw and the command vanished from
    // the record — so the objective it satisfied could never tick.
    const recorded = await recordedCommands(client);
    const binary = recorded.find((entry) => entry.command === 'cat /bin/ls');
    expect(binary).toBeDefined();
    expect(binary?.output).not.toContain('\u0000');
    expect(binary?.output).toContain('ELF');
  });

  it('survives a stray escape sequence without losing the text around it', async () => {
    const { client, terminal } = await playerInALab();

    await terminal.submit('cat coloured.txt');
    harness.labManager.sendRaw('\u001b[1;32mgreen\u001b[0m and \u001b]0;a title\u0007plain\r\n');
    await sleep(700);
    await terminal.close();

    const recorded = await recordedCommands(client);
    const coloured = recorded.find((entry) => entry.command === 'cat coloured.txt');
    expect(coloured?.output).toContain('green and plain');
    expect(coloured?.output).not.toContain('\u001b');
  });
});

describe('output that floods', () => {
  it('caps what it records without dropping the command', async () => {
    const { client, terminal } = await playerInALab();

    await terminal.submit('yes');
    for (let chunk = 0; chunk < 12; chunk++) {
      harness.labManager.sendRaw('y\r\n'.repeat(4000));
      await sleep(5);
    }
    await sleep(900);
    await terminal.close();

    const recorded = await recordedCommands(client);
    const flood = recorded.find((entry) => entry.command === 'yes');
    expect(flood).toBeDefined();
    // 64 KB cap, so the record stays bounded whatever the container prints.
    expect(flood?.output.length).toBeLessThanOrEqual(64 * 1024);
  });
});

describe('the gateway refuses what it should', () => {
  it('ignores a client message it cannot parse, rather than dropping the session', async () => {
    const { terminal } = await playerInALab();
    terminal.sendText('this is not json');
    await sleep(100);
    await terminal.type('whoami');
    expect(terminal.output).toContain('player');
    await terminal.close();
  });

  it('clamps an absurd resize instead of passing it to the container', async () => {
    const { terminal } = await playerInALab();
    terminal.resize(100_000, -5);
    await sleep(100);
    await terminal.type('whoami');
    expect(terminal.output).toContain('player');
    await terminal.close();
  });

  it('tells the player when the lab shuts down underneath them', async () => {
    const { client, terminal, sessionId } = await playerInALab();
    await terminal.type('whoami');
    await client.delete(`/api/labs/${sessionId}`);
    await sleep(500);
    expect(terminal.closed).toBe(true);
  });

  it('banks the command in flight when the lab closes', async () => {
    const { client, terminal, sessionId } = await playerInALab();
    // No following command, so only the close can bank this one.
    terminal.sendText(JSON.stringify({ type: 'input', data: 'pwd\r' }));
    await sleep(200);
    await client.delete(`/api/labs/${sessionId}`);
    await sleep(600);

    const recorded = await recordedCommands(client);
    expect(recorded.map((entry) => entry.command)).toContain('pwd');
  });
});

describe('progress pushed back down the socket', () => {
  it('ticks the objective while the player is still looking at the output', async () => {
    const { terminal } = await playerInALab();

    await terminal.type('whoami');
    const afterFirst = terminal.progressUpdates.at(-1);
    expect(afterFirst?.tasks.find((task: any) => task.taskId === 'identify-user')?.completed).toBe(
      true,
    );
    expect(afterFirst?.tasks.find((task: any) => task.taskId === 'identify-cwd')?.completed).toBe(
      false,
    );

    await terminal.type('pwd');
    const afterSecond = terminal.progressUpdates.at(-1);
    expect(afterSecond?.tasks.find((task: any) => task.taskId === 'identify-cwd')?.completed).toBe(
      true,
    );

    await terminal.close();
  });

  it('never sends a flag down the socket, whatever the player reads', async () => {
    const { terminal } = await playerInALab();
    await terminal.type('cat README.txt');
    await terminal.close();

    for (const update of terminal.progressUpdates) {
      const serialised = JSON.stringify(update);
      // `flagAccepted` is a boolean and belongs here; a flag's *text* never does.
      expect(serialised).not.toContain('ZR{');
      expect(serialised).not.toContain('ZERO{');
      expect(Object.keys(update)).not.toContain('flag');
    }
  });
});
