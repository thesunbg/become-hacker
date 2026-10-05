import type { Server } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { WebSocket } from 'ws';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { TerminalGateway } from '../src/terminal/terminal.gateway';
import { startFakeLabManager, type FakeLabManager } from './fake-lab-manager';
import { TEST_DATABASE_URL } from './global-setup';

export const WEB_ORIGIN = 'http://localhost:5173';
const LAB_TOKEN = 'test-lab-token';

export interface Harness {
  readonly baseUrl: string;
  readonly prisma: PrismaService;
  readonly labManager: FakeLabManager;
  close(): Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const labManager = await startFakeLabManager(LAB_TOKEN);

  // The lab manager's address is only known once it is listening. APP_CONFIG reads the
  // environment when its provider is created, which happens below, so this is in time.
  // Everything else lives in test/setup-env.ts, which runs before any module is imported.
  Object.assign(process.env, {
    LAB_MANAGER_URL: labManager.url,
    LAB_MANAGER_TOKEN: LAB_TOKEN,
  });

  // Truncated before the app starts, so the mission registry sync that happens during
  // startup is the real one. Clearing the database afterwards and re-syncing by hand would
  // hide exactly the kind of start-up ordering bug this is here to catch.
  const scrubber = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL ?? TEST_DATABASE_URL } },
  });
  await scrubber.$executeRawUnsafe(`
    TRUNCATE TABLE lab_events, lab_sessions, xp_transactions, user_skills,
                   user_missions, audit_logs, profiles, users, missions
    RESTART IDENTITY CASCADE
  `);
  await scrubber.$disconnect();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({ origin: WEB_ORIGIN, credentials: true });

  await app.init();
  const server = app.getHttpServer() as Server;
  app.get(TerminalGateway).attachTo(server);
  await app.listen(0);

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  const prisma = app.get(PrismaService);
  const redis = app.get((await import('../src/redis/redis.service')).RedisService);
  await redis.client.flushdb();

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    prisma,
    labManager,
    async close() {
      await app.close();
      await labManager.close();
    },
  };
}

/** A tiny HTTP client that keeps the session cookie and sends a trusted Origin. */
export class Client {
  cookie = '';

  constructor(private readonly baseUrl: string) {}

  async request(
    method: string,
    path: string,
    body?: unknown,
    options: { origin?: string | null } = {},
  ): Promise<{ status: number; body: any; raw: string }> {
    const origin = options.origin === undefined ? WEB_ORIGIN : options.origin;
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (origin !== null) headers.origin = origin;
    if (this.cookie !== '') headers.cookie = this.cookie;

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const setCookie = response.headers.get('set-cookie');
    if (setCookie !== null) {
      const pair = setCookie.split(';')[0] as string;
      this.cookie = pair.endsWith('=') ? '' : pair;
    }

    const raw = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = raw === '' ? undefined : JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    return { status: response.status, body: parsed, raw };
  }

  get(path: string) {
    return this.request('GET', path);
  }

  post(path: string, body?: unknown, options?: { origin?: string | null }) {
    return this.request('POST', path, body, options);
  }

  delete(path: string) {
    return this.request('DELETE', path);
  }
}

/** A terminal client that types like a person and collects what comes back. */
export class TerminalClient {
  private readonly socket: WebSocket;
  output = '';
  readonly progressUpdates: any[] = [];
  closed = false;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; data?: string; progress?: any };
      if (message.type === 'output') this.output += message.data ?? '';
      if (message.type === 'progress') this.progressUpdates.push(message.progress);
      if (message.type === 'closed') this.closed = true;
    });
  }

  static async connect(
    baseUrl: string,
    sessionId: string,
    cookie: string,
  ): Promise<TerminalClient> {
    const url = `${baseUrl.replace(/^http/, 'ws')}/ws/terminal?sessionId=${sessionId}`;
    const socket = new WebSocket(url, { headers: { cookie } });
    const client = new TerminalClient(socket);

    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
      socket.once('unexpected-response', (_req, res) =>
        reject(new Error(`handshake refused with ${res.statusCode}`)),
      );
    });
    return client;
  }

  /** Types a command one character at a time, then Enter — exactly as a player would. */
  async type(command: string): Promise<void> {
    await this.submit(command);
    // Long enough for the output to arrive and the idle timer to bank the command.
    await sleep(700);
  }

  /**
   * Types a command and returns as soon as it is sent, before the idle timer banks it.
   *
   * For tests that need to inject output of their own into the window where the command is
   * still open; `type` waits past the settle, by which point the record is closed.
   */
  async submit(command: string): Promise<void> {
    for (const char of command) {
      this.socket.send(JSON.stringify({ type: 'input', data: char }));
      await sleep(1);
    }
    this.socket.send(JSON.stringify({ type: 'input', data: '\r' }));
    await sleep(60);
  }

  resize(cols: number, rows: number): void {
    this.socket.send(JSON.stringify({ type: 'resize', cols, rows }));
  }

  /** Sends a frame verbatim, for protocol cases a well-behaved client never produces. */
  sendText(data: string): void {
    this.socket.send(data);
  }

  async close(): Promise<void> {
    this.socket.close();
    await sleep(200);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
