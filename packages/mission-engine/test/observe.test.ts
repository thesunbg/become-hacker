import { describe, expect, it } from 'vitest';
import { looksLikeFailure, observeCommand, observeStream, portsInOutput } from '../src/observe.js';
import { parseCommand } from '../src/command.js';
import { applyCd } from '../src/observe.js';
import { Stream } from './helpers.js';

const HOME = '/home/player';

describe('looksLikeFailure', () => {
  it('recognises a missing file', () => {
    expect(looksLikeFailure('cat: /home/player/.secret: No such file or directory')).toBe(true);
  });

  it('recognises a permission error', () => {
    expect(looksLikeFailure('cat: vault: Permission denied')).toBe(true);
  });

  it('treats no captured output as success, not failure', () => {
    expect(looksLikeFailure(undefined)).toBe(false);
    expect(looksLikeFailure('')).toBe(false);
  });

  it('does not flag ordinary output', () => {
    expect(looksLikeFailure('ZR{h1dd3n_1n_pl41n_s1ght}')).toBe(false);
  });
});

describe('applyCd', () => {
  const cd = (cwd: string, line: string): string => applyCd(cwd, parseCommand(line)!, HOME);

  it('follows a relative directory change', () => {
    expect(cd(HOME, 'cd .null')).toBe('/home/player/.null');
  });

  it('follows an absolute directory change', () => {
    expect(cd(HOME, 'cd /etc')).toBe('/etc');
  });

  it('sends a bare cd home', () => {
    expect(cd('/etc', 'cd')).toBe(HOME);
  });

  it('walks back up', () => {
    expect(cd('/home/player/.null', 'cd ..')).toBe(HOME);
  });

  it('leaves the directory alone for any other command', () => {
    expect(cd('/etc', 'ls -la')).toBe('/etc');
  });
});

describe('observeCommand', () => {
  it('records a file read with a relative path as an absolute one', () => {
    const { filesRead } = observeCommand('cat README.txt', HOME, 'hello', HOME);
    expect(filesRead).toEqual(['/home/player/README.txt']);
  });

  it('does not record a file the player failed to read', () => {
    const { filesRead } = observeCommand(
      'cat .secret',
      HOME,
      'cat: .secret: No such file or directory',
      HOME,
    );
    expect(filesRead).toEqual([]);
  });

  it('does not record a file the player was denied', () => {
    const { filesRead } = observeCommand('cat vault', HOME, 'cat: vault: Permission denied', HOME);
    expect(filesRead).toEqual([]);
  });

  it('skips the pattern when grep is the reader', () => {
    const { filesRead } = observeCommand('grep failed auth.log', '/var/log', 'line', HOME);
    expect(filesRead).toEqual(['/var/log/auth.log']);
  });

  it('records every file of a multi-file read', () => {
    const { filesRead } = observeCommand('cat a.txt b.txt', HOME, 'out', HOME);
    expect(filesRead).toEqual(['/home/player/a.txt', '/home/player/b.txt']);
  });

  it('ignores stdin and unexpanded globs', () => {
    const { filesRead } = observeCommand('cat - *.txt', HOME, 'out', HOME);
    expect(filesRead).toEqual([]);
  });

  it('reports where a cd left the player', () => {
    expect(observeCommand('cd .null', HOME, '', HOME).cwd).toBe('/home/player/.null');
  });

  it('reads a file through a pipeline, relative to the directory it was run in', () => {
    const { filesRead } = observeCommand('cat auth.log | grep failed', '/var/log', 'hit', HOME);
    expect(filesRead).toContain('/var/log/auth.log');
  });

  it('extracts ports from a port-scanning command', () => {
    const output = 'Not shown: 998 closed ports\n22/tcp open ssh\n80/tcp open http';
    expect(observeCommand('nmap 10.0.0.5', HOME, output, HOME).ports).toEqual([22, 80]);
  });

  it('does not read ports out of unrelated output', () => {
    expect(observeCommand('cat notes.txt', HOME, '80/tcp open http', HOME).ports).toEqual([]);
  });
});

describe('observeStream', () => {
  it('resolves a read against the directory the player had navigated to', () => {
    const stream = new Stream('m').started().run('cd .null', '').run('cat first_contact', 'flag');
    const { filesRead } = observeStream(stream.events, HOME);
    expect([...filesRead]).toContain('/home/player/.null/first_contact');
  });

  it('prefers a measured working directory over the derived one', () => {
    const stream = new Stream('m').run('cat notes.txt', 'out', '/var/log');
    const { filesRead } = observeStream(stream.events, HOME);
    expect([...filesRead]).toEqual(['/var/log/notes.txt']);
  });

  it('merges a discovery the lab reported directly', () => {
    const stream = new Stream('m');
    stream.events.push({
      sessionId: 's',
      missionId: 'm',
      timestamp: '2026-01-01T00:00:00.000Z',
      type: 'FILE_FOUND',
      path: '/etc/shadow',
    });
    expect([...observeStream(stream.events, HOME).filesRead]).toEqual(['/etc/shadow']);
  });
});

describe('portsInOutput', () => {
  it('reads the nmap form, port and protocol together', () => {
    expect(portsInOutput('22/tcp   open  ssh\n8080/tcp open  http-proxy')).toEqual([22, 8080]);
  });

  it('reads the ss form, where the port closes an address', () => {
    const output = [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port',
      'LISTEN 0      128          0.0.0.0:22         0.0.0.0:*',
      'LISTEN 0      511        127.0.0.1:8080       0.0.0.0:*',
    ].join('\n');
    expect(portsInOutput(output)).toEqual([22, 8080]);
  });

  it('reads a bracketed IPv6 address', () => {
    expect(portsInOutput('LISTEN 0 128 [::]:443 [::]:*')).toEqual([443]);
  });

  it('reports each port once, however many sockets are listening on it', () => {
    expect(portsInOutput('0.0.0.0:80 x\n127.0.0.1:80 y\n[::]:80 z')).toEqual([80]);
  });

  it('does not mistake a URL path for a port', () => {
    expect(portsInOutput('http://bank.local:8080/admin')).toEqual([]);
  });

  it('ignores the wildcard peer column, which names no port', () => {
    expect(portsInOutput('0.0.0.0:*  [::]:*')).toEqual([]);
  });

  it('rejects a number too large to be a port', () => {
    expect(portsInOutput('0.0.0.0:99999 x')).toEqual([]);
  });

  it('finds nothing in output that lists no sockets', () => {
    expect(portsInOutput('Cannot open netlink socket: Permission denied')).toEqual([]);
  });

  it('reads a port out of lsof, which also names listening sockets', () => {
    const output = 'nginx  901  root  6u  IPv4  18221  0t0  TCP *:8080 (LISTEN)';
    expect(observeCommand('lsof -i -P -n', HOME, output, HOME).ports).toEqual([8080]);
  });
});
