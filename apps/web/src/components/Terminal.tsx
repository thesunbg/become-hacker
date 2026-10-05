import { useEffect, useRef } from 'react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import type { MissionProgress, TerminalServerMessage } from '@zero-root/types';

/**
 * The terminal.
 *
 * Keystrokes go up the socket and bytes come back; nothing is interpreted here. That is
 * deliberate — the server reconstructs what was typed and decides what it means, so a player
 * cannot tell the game they ran a command they did not run.
 */
export function Terminal({
  sessionId,
  onProgress,
  onClosed,
}: {
  sessionId: string;
  onProgress: (progress: MissionProgress) => void;
  onClosed: (reason: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Callbacks are held in refs so a re-render never tears down the socket.
  const progressRef = useRef(onProgress);
  const closedRef = useRef(onClosed);
  progressRef.current = onProgress;
  closedRef.current = onClosed;

  useEffect(() => {
    if (host.current === null) return;

    const term = new Xterm({
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 13,
      cursorBlink: true,
      convertEol: false,
      theme: {
        background: '#07090b',
        foreground: '#dfe5ec',
        cursor: '#35d07f',
        selectionBackground: '#1f3b2c',
        black: '#07090b',
        green: '#35d07f',
        blue: '#4ea6ff',
        yellow: '#f0b429',
        red: '#f2555a',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);

    // xterm schedules its own rendering work on a later frame. Measuring or disposing it
    // while that work is queued throws from inside its viewport, so every call is guarded
    // by a disposal flag and skipped while the host has no size to measure.
    let disposed = false;
    let frame = 0;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(
      `${protocol}://${window.location.host}/ws/terminal?sessionId=${encodeURIComponent(sessionId)}`,
    );

    const sendResize = (): void => {
      if (disposed || host.current === null) return;
      if (host.current.clientWidth === 0 || host.current.clientHeight === 0) return;

      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        try {
          fit.fit();
        } catch {
          // The terminal is being torn down; its size no longer matters.
          return;
        }
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
        }
      });
    };

    socket.addEventListener('open', () => {
      // Written without a newline: the `ready` message clears this same line. `writeln`
      // would move the cursor on first, leaving the notice on screen for the whole session.
      term.write('\u001b[90mconnecting to lab…\u001b[0m');
      sendResize();
    });

    socket.addEventListener('message', (event) => {
      if (disposed) return;
      const message = JSON.parse(String(event.data)) as TerminalServerMessage;
      switch (message.type) {
        case 'output':
          term.write(message.data);
          break;
        case 'ready':
          // Carriage return first, then erase: the sequence clears the line the notice is on.
          term.write('\r\u001b[2K');
          break;
        case 'progress':
          progressRef.current(message.progress);
          break;
        case 'closed':
          term.writeln(`\r\n\u001b[33m${message.reason}\u001b[0m`);
          closedRef.current(message.reason);
          break;
      }
    });

    socket.addEventListener('close', () => {
      if (!disposed) term.writeln('\r\n\u001b[90mdisconnected\u001b[0m');
    });

    socket.addEventListener('error', () => {
      if (!disposed) closedRef.current('Lost the connection to the lab.');
    });

    const input = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const observer = new ResizeObserver(() => sendResize());
    observer.observe(host.current);

    return () => {
      // Order matters: stop everything that could touch the terminal before disposing it.
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      input.dispose();
      socket.close();
      term.dispose();
    };
  }, [sessionId]);

  return (
    <div
      ref={host}
      className="h-[26rem] w-full overflow-hidden rounded-md border border-border bg-void p-2"
    />
  );
}
