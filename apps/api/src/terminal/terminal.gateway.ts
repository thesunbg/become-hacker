import type { Server as HttpServer } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { WebSocket, WebSocketServer } from 'ws';
import type { TerminalClientMessage, TerminalServerMessage } from '@zero-root/types';
import { APP_CONFIG, type AppConfig } from '../config/configuration';
import { parseCookies } from '../common/cookies';
import { SessionService } from '../auth/session.service';
import { EventsService } from '../events/events.service';
import { LabsService } from '../labs/labs.service';
import { LabManagerClient } from '../labs/lab-manager.client';
import { ProgressService } from '../missions/progress.service';
import { TerminalRecorder } from './terminal-recorder';

export const TERMINAL_PATH = '/ws/terminal';

/**
 * How long output must be quiet before a command is banked.
 *
 * Long enough that a shell's immediate reply — including its error for a missing file —
 * arrives first; short enough that an objective ticks while the player is still looking at
 * the output that satisfied it.
 */
export const SETTLE_IDLE_MS = 400;

/** Whatever shape `ws` hands over — Buffer, fragments, ArrayBuffer — as bytes. */
function toBytes(data: unknown): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data as Buffer[]);
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(String(data), 'utf8');
}

/**
 * The terminal gateway.
 *
 * Browser -> WebSocket -> here -> lab manager -> sandbox. This is the only hop the player's
 * keystrokes make through the API, and the API never interprets them as anything it would
 * execute: they are bytes to forward, plus a transcript to record.
 *
 * Two jobs:
 *  1. **Authorise.** The upgrade is accepted only for a signed session cookie whose user
 *     owns the lab session named in the query. A player cannot attach to someone else's lab
 *     by guessing its id.
 *  2. **Record.** Reconstructed commands become COMPLETED_EXECUTED events, progress is
 *     re-evaluated by the engine, and the refreshed progress is pushed back — so objectives
 *     tick as the player works, without the client ever asserting one.
 */
@Injectable()
export class TerminalGateway {
  private readonly logger = new Logger(TerminalGateway.name);
  private readonly wss = new WebSocketServer({ noServer: true });

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: SessionService,
    private readonly labs: LabsService,
    private readonly labManager: LabManagerClient,
    private readonly events: EventsService,
    private readonly progress: ProgressService,
  ) {}

  attachTo(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== TERMINAL_PATH) return;

      void (async () => {
        const token = parseCookies(req.headers.cookie)[this.config.sessionCookieName];
        const session = await this.sessions.resolve(token);
        if (session === null) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const sessionId = url.searchParams.get('sessionId') ?? '';
        const lab = await this.labs.findActive(session.userId, sessionId);
        if (lab === null || lab.labId === null) {
          // Same response whether the lab does not exist or belongs to someone else.
          socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
          socket.destroy();
          return;
        }

        this.wss.handleUpgrade(req, socket, head, (client) => {
          this.bridge(client, {
            userId: session.userId,
            sessionId: lab.id,
            missionId: lab.missionId,
            labId: lab.labId as string,
          });
        });
      })().catch(() => {
        socket.destroy();
      });
    });
  }

  private bridge(
    client: WebSocket,
    context: { userId: string; sessionId: string; missionId: string; labId: string },
  ): void {
    const recorder = new TerminalRecorder();
    const upstream = new WebSocket(this.labManager.attachUrl(context.labId), {
      headers: { 'x-lab-token': this.labManager.token },
    });

    const send = (message: TerminalServerMessage): void => {
      if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(message));
    };

    // Recording is serialised: two commands in flight must not interleave their writes or
    // race the progress re-evaluation.
    let queue: Promise<void> = Promise.resolve();
    const enqueue = (work: () => Promise<void>): void => {
      queue = queue.then(work).catch((error: unknown) => {
        this.logger.error(`Failed to record terminal activity: ${String(error)}`);
      });
    };

    const record = (command: string, output: string): void => {
      enqueue(async () => {
        await this.events.record(
          context.userId,
          context.missionId,
          'COMMAND_EXECUTED',
          { command, output },
          context.sessionId,
        );
        const { progress } = await this.progress.sync(context.userId, context.missionId);
        send({ type: 'progress', progress });
      });
    };

    // Banks the command in flight once its output has gone quiet, so the checklist ticks
    // while the player is still reading the output rather than on their next keystroke.
    let idleTimer: NodeJS.Timeout | undefined;
    const settleSoon = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const finished = recorder.settle();
        if (finished !== null) record(finished.command, finished.output);
      }, SETTLE_IDLE_MS);
      idleTimer.unref?.();
    };

    upstream.on('open', () => send({ type: 'ready' }));

    // The container's output is a byte stream, not a sequence of strings. A frame can end in
    // the middle of a multi-byte character — which in Vietnamese is most of them — and
    // decoding each frame on its own turns that character into two replacement marks, on the
    // player's screen and in the recorded output alike. The decoder holds the partial
    // sequence until the rest of it arrives.
    const decoder = new StringDecoder('utf8');

    upstream.on('message', (data) => {
      const text = decoder.write(toBytes(data));
      if (text === '') return;
      recorder.onOutput(text);
      send({ type: 'output', data: text });
      settleSoon();
    });

    upstream.on('close', () => {
      // A truncated character at the very end would otherwise be dropped silently.
      const tail = decoder.end();
      if (tail !== '') {
        recorder.onOutput(tail);
        send({ type: 'output', data: tail });
      }
      const last = recorder.flush();
      if (last !== null) record(last.command, last.output);
      send({ type: 'closed', reason: 'The lab has shut down.' });
      client.close(1000, 'lab closed');
    });

    upstream.on('error', (error) => {
      send({ type: 'closed', reason: `Could not reach the lab: ${error.message}` });
      client.close(1011, 'lab unreachable');
    });

    client.on('message', (raw) => {
      let message: TerminalClientMessage;
      try {
        message = JSON.parse(raw.toString()) as TerminalClientMessage;
      } catch {
        return; // a client that cannot speak the protocol is simply ignored
      }

      if (message.type === 'resize') {
        const cols = Math.min(500, Math.max(20, Math.floor(message.cols)));
        const rows = Math.min(200, Math.max(5, Math.floor(message.rows)));
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(`\u0000resize:${cols}x${rows}`);
        }
        return;
      }

      if (message.type === 'input' && typeof message.data === 'string') {
        for (const completed of recorder.onInput(message.data)) {
          record(completed.command, completed.output);
        }
        if (upstream.readyState === WebSocket.OPEN) upstream.send(message.data);
        // A command that produces no output at all still needs banking.
        settleSoon();
      }
    });

    const teardown = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer);
      const last = recorder.flush();
      if (last !== null) record(last.command, last.output);
      if (upstream.readyState === WebSocket.OPEN || upstream.readyState === WebSocket.CONNECTING) {
        upstream.close();
      }
    };

    client.on('close', teardown);
    client.on('error', teardown);
  }
}
