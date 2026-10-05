import { createServer, type Server } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

/**
 * A stand-in for the lab manager that speaks its HTTP + WebSocket contract and simulates the
 * `linux-basic` shell against the real files baked into the lab image.
 *
 * This is what lets the vertical slice be tested end to end on a machine with no Docker
 * daemon: everything upstream of the container is the production code path — the API's
 * gateway, the terminal recorder, the event stream, the engine, the XP ledger — and only the
 * container itself is simulated. The lab manager's own side of this contract is covered by
 * its own tests.
 *
 * It deliberately does *not* shell out. Nothing here executes a player's input.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const ROOTFS = join(repoRoot, 'labs/linux-basic/rootfs');
const HOME = '/home/player';
const PROMPT = 'player@laptop:~$ ';

function normalize(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `${absolute ? '/' : ''}${out.join('/')}`;
}

function resolve(cwd: string, target: string): string {
  if (target === '~') return HOME;
  if (target.startsWith('~/')) return normalize(`${HOME}/${target.slice(2)}`);
  if (target.startsWith('/')) return normalize(target);
  return normalize(`${cwd}/${target}`);
}

/** A tiny simulated shell. It interprets a fixed set of commands; it never runs anything. */
class SimulatedShell {
  private cwd = HOME;

  private host(guest: string): string | null {
    const candidate = join(ROOTFS, guest.replace(/^\//, ''));
    if (!candidate.startsWith(ROOTFS)) return null;
    return existsSync(candidate) ? candidate : null;
  }

  run(line: string): string {
    const outputs: string[] = [];

    for (const segment of line.split(/\s*(?:\|\||&&|\||;)\s*/).filter((s) => s.trim() !== '')) {
      const tokens = segment.trim().split(/\s+/);
      const program = tokens[0] as string;
      const flags = tokens.filter((t) => t.startsWith('-')).join('');
      const args = tokens.slice(1).filter((t) => !t.startsWith('-'));

      switch (program) {
        case 'whoami':
          outputs.push('player');
          break;
        case 'pwd':
          outputs.push(this.cwd);
          break;
        case 'cd': {
          const target = args[0] ?? '~';
          const next = resolve(this.cwd, target);
          if (this.host(next) === null) outputs.push(`bash: cd: ${target}: No such file or directory`);
          else this.cwd = next;
          break;
        }
        case 'ls': {
          const dir = args[0] === undefined ? this.cwd : resolve(this.cwd, args[0]);
          const host = this.host(dir);
          if (host === null) {
            outputs.push(`ls: cannot access '${args[0] ?? dir}': No such file or directory`);
            break;
          }
          const entries = readdirSync(host)
            .filter((name) => flags.includes('a') || !name.startsWith('.'))
            .sort();
          outputs.push(entries.join(flags.includes('l') ? '\n' : '  '));
          break;
        }
        case 'cat': {
          for (const arg of args) {
            const guest = resolve(this.cwd, arg);
            const host = this.host(guest);
            if (host === null) outputs.push(`cat: ${arg}: No such file or directory`);
            else if (statSync(host).isDirectory()) outputs.push(`cat: ${arg}: Is a directory`);
            else outputs.push(readFileSync(host, 'utf8').trimEnd());
          }
          break;
        }
        case 'find': {
          const base = args[0] === undefined ? this.cwd : resolve(this.cwd, args[0]);
          const found: string[] = [];
          const walk = (guest: string): void => {
            const host = this.host(guest);
            if (host === null) return;
            if (!statSync(host).isDirectory()) {
              found.push(guest);
              return;
            }
            found.push(guest);
            for (const name of readdirSync(host)) walk(`${guest}/${name}`);
          };
          walk(base);
          outputs.push(found.join('\n'));
          break;
        }
        case 'echo':
          outputs.push(args.join(' '));
          break;
        default:
          outputs.push(`bash: ${program}: command not found`);
          break;
      }
    }

    return outputs.filter((out) => out !== '').join('\n');
  }
}

export interface FakeLabManager {
  readonly url: string;
  readonly created: { image: string; missionId: string; userId: string }[];
  readonly destroyed: string[];
  /** Set to make lab creation fail, as an unreachable container runtime would. */
  available: boolean;
  close(): Promise<void>;
}

export async function startFakeLabManager(token: string): Promise<FakeLabManager> {
  const created: { image: string; missionId: string; userId: string }[] = [];
  const destroyed: string[] = [];
  const labs = new Map<string, SimulatedShell>();
  const state = { available: true };

  const authorized = (headers: Record<string, unknown>): boolean =>
    headers['x-lab-token'] === token;

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://fake.internal');

      if (!authorized(req.headers as Record<string, unknown>)) {
        res.writeHead(401).end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/labs') {
        if (!state.available) {
          res.writeHead(503, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'The container runtime is unavailable.' }));
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as {
          image: string;
          missionId: string;
          userId: string;
        };
        created.push(body);

        const labId = randomUUID();
        labs.set(labId, new SimulatedShell());
        res.writeHead(201, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            labId,
            missionId: body.missionId,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          }),
        );
        return;
      }

      const match = /^\/labs\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'DELETE' && match) {
        const labId = match[1] as string;
        destroyed.push(labId);
        labs.delete(labId);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ destroyed: true }));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: 'not found' }));
    })().catch(() => res.writeHead(500).end());
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://fake.internal');
    const labId = url.searchParams.get('labId') ?? '';
    const shell = labs.get(labId);

    if (!authorized(req.headers as Record<string, unknown>) || shell === undefined) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      // The real container's bash prints a prompt on attach.
      ws.send(PROMPT);
      let line = '';

      ws.on('message', (raw) => {
        const data = raw.toString();
        if (data.startsWith('\u0000resize:')) return;

        for (const char of data) {
          if (char === '\r' || char === '\n') {
            ws.send('\r\n'); // the shell echoes the newline
            const command = line.trim();
            line = '';
            if (command !== '') {
              const output = shell.run(command);
              if (output !== '') ws.send(`${output}\r\n`);
            }
            ws.send(PROMPT);
            continue;
          }
          if (char === '\u007f' || char === '\b') {
            line = line.slice(0, -1);
            ws.send('\b \b');
            continue;
          }
          if (char < ' ') continue;
          line += char;
          ws.send(char); // the shell echoes what you type
        }
      });
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    created,
    destroyed,
    get available() {
      return state.available;
    },
    set available(value: boolean) {
      state.available = value;
    },
    async close() {
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
