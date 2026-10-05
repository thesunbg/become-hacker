import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { loadManifest, type LabManagerConfig } from './config.js';
import { buildSandboxSpec } from './sandbox-spec.js';
import { LabRegistry } from './registry.js';
import { SandboxUnavailableError, type SandboxDriver } from './driver.js';

/** Constant-time comparison, so a wrong token leaks nothing through timing. */
function tokensMatch(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req: IncomingMessage, limitBytes = 16 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limitBytes) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export interface LabManager {
  readonly server: Server;
  readonly registry: LabRegistry;
  listen(): Promise<number>;
  close(): Promise<void>;
}

/**
 * The lab manager's HTTP + WebSocket surface.
 *
 * Every route requires the shared token, and the socket is bound to the loopback interface
 * by default: this service is internal, and nothing about it is meant to be reachable from a
 * browser. The player's terminal reaches it only by being proxied through the API's gateway
 * (docs/05-architecture.md).
 */
export function createLabManager(
  config: LabManagerConfig,
  driver: SandboxDriver,
): LabManager {
  const registry = new LabRegistry(driver);

  const authorized = (req: IncomingMessage): boolean => {
    const header = req.headers['x-lab-token'];
    const presented = Array.isArray(header) ? header[0] : header;
    return presented !== undefined && tokensMatch(presented, config.apiToken);
  };

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://lab-manager.internal');

      if (req.method === 'GET' && url.pathname === '/healthz') {
        try {
          await driver.ping();
          json(res, 200, { status: 'ok', labs: registry.list().length });
        } catch (error) {
          json(res, 503, {
            status: 'unavailable',
            error: error instanceof Error ? error.message : 'unknown',
          });
        }
        return;
      }

      if (!authorized(req)) {
        json(res, 401, { error: 'unauthorized' });
        return;
      }

      if (req.method === 'POST' && url.pathname === '/labs') {
        let body: Record<string, unknown>;
        try {
          body = (await readBody(req)) as Record<string, unknown>;
        } catch {
          json(res, 400, { error: 'invalid body' });
          return;
        }

        const image = typeof body.image === 'string' ? body.image : '';
        const missionId = typeof body.missionId === 'string' ? body.missionId : '';
        const userId = typeof body.userId === 'string' ? body.userId : '';
        if (image === '' || missionId === '' || userId === '') {
          json(res, 400, { error: 'image, missionId and userId are required' });
          return;
        }

        // Only a directory under labs/ can be started. An arbitrary image name — from a
        // forged request or a mistyped mission — is refused rather than pulled and run.
        const manifest = loadManifest(config, image);
        if (!manifest) {
          json(res, 400, { error: `unknown lab image "${image}"` });
          return;
        }

        const labId = randomUUID();
        const spec = buildSandboxSpec({
          manifest,
          limits: config.limits,
          labId,
          missionId,
          labNetwork: config.labNetwork,
          imagePrefix: config.imagePrefix,
        });

        try {
          const handle = await driver.create(spec);
          const session = registry.register(
            { labId, missionId, userId, handle, createdAt: Date.now() },
            config.limits,
          );
          json(res, 201, {
            labId: session.labId,
            missionId: session.missionId,
            expiresAt: new Date(session.expiresAt).toISOString(),
          });
        } catch (error) {
          const unavailable = error instanceof SandboxUnavailableError;
          json(res, unavailable ? 503 : 500, {
            error: error instanceof Error ? error.message : 'failed to create lab',
          });
        }
        return;
      }

      const destroyMatch = /^\/labs\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (req.method === 'DELETE' && destroyMatch) {
        const destroyed = await registry.destroy(destroyMatch[1] as string);
        json(res, destroyed ? 200 : 404, { destroyed });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/labs') {
        json(res, 200, {
          labs: registry.list().map((session) => ({
            labId: session.labId,
            missionId: session.missionId,
            userId: session.userId,
            expiresAt: new Date(session.expiresAt).toISOString(),
          })),
        });
        return;
      }

      json(res, 404, { error: 'not found' });
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
    });
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://lab-manager.internal');
    const labId = url.searchParams.get('labId') ?? '';

    if (!authorized(req) || url.pathname !== '/attach' || registry.get(labId) === undefined) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      void attachTerminal(ws, labId);
    });
  });

  async function attachTerminal(ws: WebSocket, labId: string): Promise<void> {
    const session = registry.get(labId);
    if (!session) {
      ws.close(1011, 'lab is gone');
      return;
    }

    try {
      const terminal = await driver.attach(session.handle);

      terminal.onData((chunk) => {
        if (ws.readyState === ws.OPEN) ws.send(chunk);
      });
      terminal.onClose(() => {
        if (ws.readyState === ws.OPEN) ws.close(1000, 'lab closed');
      });

      ws.on('message', (raw, isBinary) => {
        if (isBinary) {
          terminal.write(raw.toString());
          return;
        }
        // A control frame resizes; anything else is keystrokes.
        const text = raw.toString();
        if (text.startsWith('\u0000resize:')) {
          const [cols, rows] = text.slice('\u0000resize:'.length).split('x').map(Number);
          if (Number.isFinite(cols) && Number.isFinite(rows)) {
            terminal.resize(cols as number, rows as number);
          }
          return;
        }
        terminal.write(text);
      });

      ws.on('close', () => terminal.close());
      ws.on('error', () => terminal.close());
    } catch (error) {
      ws.close(1011, error instanceof Error ? error.message.slice(0, 120) : 'attach failed');
    }
  }

  return {
    server,
    registry,
    listen(): Promise<number> {
      return new Promise((resolve) => {
        // Loopback by default: this service is internal (docs/06-security.md).
        server.listen(config.port, process.env.LAB_MANAGER_HOST ?? '127.0.0.1', () => {
          const address = server.address();
          resolve(typeof address === 'object' && address !== null ? address.port : config.port);
        });
      });
    },
    async close(): Promise<void> {
      await registry.destroyAll();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
