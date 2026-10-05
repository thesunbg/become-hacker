import { describe, expect, it } from 'vitest';
import type { MissionTask } from '@zero-root/types';
import { evaluateMission } from '../src/evaluate.js';
import { Stream, mission } from './helpers.js';

/**
 * Every objective type the format defines, including the ones no authored mission uses yet.
 *
 * Chapters 2 and 3 are built on these: a mission that discovers a port, maps a service,
 * changes a config or reads a log must work the day it is written as a JSON file, without
 * anyone touching the engine. An objective type with no test is a promise the format makes
 * and the engine has never been asked to keep.
 */

const only = (task: Omit<MissionTask, 'description'>) =>
  mission({ tasks: [{ description: 'the objective', ...task }] });

const done = (events: Parameters<typeof evaluateMission>[1], task: Parameters<typeof only>[0]) =>
  evaluateMission(only(task), events).state === 'COMPLETED';

describe('PORT_FOUND', () => {
  const task = { id: 't1', type: 'PORT_FOUND' as const, target: '8080' };

  it('is satisfied by a port the lab reported', () => {
    expect(done(new Stream('ch01-mission-001').started().port(8080).events, task)).toBe(true);
  });

  it('is satisfied by a port read out of a scan the player ran', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('nmap bank.local', '8080/tcp open  http-proxy');
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied by a port in real `ss -ltn` output, which never says tcp', () => {
    // The format `ss` actually prints. An earlier engine only understood nmap's `8080/tcp`,
    // which made this — the tool the labs install — find nothing at all.
    const output = [
      'State  Recv-Q Send-Q Local Address:Port  Peer Address:Port',
      'LISTEN 0      128          0.0.0.0:22         0.0.0.0:*',
      'LISTEN 0      511        127.0.0.1:8080       0.0.0.0:*',
    ].join('\n');
    const stream = new Stream('ch01-mission-001').started().run('ss -ltn', output);
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied by a port in real `netstat -ltn` output', () => {
    const output = [
      'Active Internet connections (only servers)',
      'Proto Recv-Q Send-Q Local Address  Foreign Address  State',
      'tcp        0      0 0.0.0.0:8080   0.0.0.0:*        LISTEN',
    ].join('\n');
    const stream = new Stream('ch01-mission-001').started().run('netstat -ltn', output);
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied by an IPv6 listener, where the address is bracketed', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('ss -ltn', 'LISTEN 0 128  [::]:8080  [::]:*');
    expect(done(stream.events, task)).toBe(true);
  });

  it('is not satisfied by a different port on the same host', () => {
    const stream = new Stream('ch01-mission-001').started().run('nmap bank.local', '22/tcp open');
    expect(done(stream.events, task)).toBe(false);
  });

  it('does not read a port out of a URL in the output', () => {
    // `:8080/` closes with a slash rather than whitespace, so it is a path, not a port field.
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('ss -ltn', 'see http://bank.local:8080/admin for the console');
    expect(done(stream.events, task)).toBe(false);
  });

  it('is not satisfied by the number appearing in unrelated output', () => {
    // Without the /tcp suffix this is just a number in a file listing.
    const stream = new Stream('ch01-mission-001').started().run('cat notes.txt', 'port 8080 maybe');
    expect(done(stream.events, task)).toBe(false);
  });

  it('is not satisfied by a scan that failed', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('nmap bank.local', 'nmap: command not found');
    expect(done(stream.events, task)).toBe(false);
  });

  it('ignores a target that is not a number, rather than matching everything', () => {
    const stream = new Stream('ch01-mission-001').started().port(8080);
    expect(done(stream.events, { ...task, target: 'http' })).toBe(false);
  });
});

describe('SERVICE_DISCOVERED', () => {
  const task = { id: 't1', type: 'SERVICE_DISCOVERED' as const, target: 'nginx' };

  it('is satisfied when the lab reports that service', () => {
    const stream = new Stream('ch01-mission-001').started().service('nginx');
    expect(done(stream.events, task)).toBe(true);
  });

  it('matches the service exactly, so a near miss is not credited', () => {
    const stream = new Stream('ch01-mission-001').started().service('nginx-ingress');
    expect(done(stream.events, task)).toBe(false);
  });

  it('accumulates across the session rather than only matching the latest', () => {
    const stream = new Stream('ch01-mission-001').started().service('nginx').service('postgres');
    expect(done(stream.events, task)).toBe(true);
  });
});

describe('CONFIG_CHANGED', () => {
  it('is satisfied when the key reaches the value the mission asks for', () => {
    const stream = new Stream('ch01-mission-001').started().config('PermitRootLogin', 'no');
    expect(
      done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'PermitRootLogin=no' }),
    ).toBe(true);
  });

  it('is not satisfied while the key still holds the wrong value', () => {
    const stream = new Stream('ch01-mission-001').started().config('PermitRootLogin', 'yes');
    expect(
      done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'PermitRootLogin=no' }),
    ).toBe(false);
  });

  it('follows the latest value, so a change away from the answer un-earns nothing already earned', () => {
    // Objectives latch: the player got there, and later undoing it is their business.
    const stream = new Stream('ch01-mission-001')
      .started()
      .config('PermitRootLogin', 'no')
      .config('PermitRootLogin', 'yes');
    expect(
      done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'PermitRootLogin=no' }),
    ).toBe(true);
  });

  it('accepts any value when the mission names only the key', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .config('PermitRootLogin', 'prohibit-password');
    expect(
      done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'PermitRootLogin' }),
    ).toBe(true);
  });

  it('is not satisfied by a different key being set', () => {
    const stream = new Stream('ch01-mission-001').started().config('PasswordAuthentication', 'no');
    expect(
      done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'PermitRootLogin' }),
    ).toBe(false);
  });

  it('handles a value that itself contains an equals sign', () => {
    // `split('=')` drops everything after the second separator, which would silently fail to
    // match a base64 value or a query string. The engine compares only the first segment.
    const stream = new Stream('ch01-mission-001').started().config('TOKEN', 'abc=def');
    expect(done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'TOKEN=abc' })).toBe(
      false,
    );
    expect(done(stream.events, { id: 't1', type: 'CONFIG_CHANGED', target: 'TOKEN' })).toBe(true);
  });
});

describe('HTTP_REQUEST', () => {
  const task = { id: 't1', type: 'HTTP_REQUEST' as const, target: '/admin' };

  it('is satisfied by a request whose URL contains the target path', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .http('GET', 'http://shop.local/admin', 200);
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied whatever the method, because the objective names a path', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .http('POST', 'http://shop.local/admin/login');
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied by a request that was refused, because reaching it is the discovery', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .http('GET', 'http://shop.local/admin', 403);
    expect(done(stream.events, task)).toBe(true);
  });

  it('is not satisfied by a request somewhere else on the same host', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .http('GET', 'http://shop.local/products');
    expect(done(stream.events, task)).toBe(false);
  });
});

describe('LOG_ANALYSIS', () => {
  const task = { id: 't1', type: 'LOG_ANALYSIS' as const, target: 'Failed password for root' };

  it('is satisfied by evidence the lab extracted', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .log('Mar 3 02:11:04 sshd[903]: Failed password for root from 10.0.0.9');
    expect(done(stream.events, task)).toBe(true);
  });

  it('is satisfied by the player finding the same line themselves', () => {
    // A mission author can rely on either: the engine reads command output as evidence too.
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('grep sshd /var/log/auth.log', 'sshd[903]: Failed password for root from 10.0.0.9');
    expect(done(stream.events, task)).toBe(true);
  });

  it('is not satisfied by a log that does not contain the evidence', () => {
    const stream = new Stream('ch01-mission-001').started().log('Accepted publickey for player');
    expect(done(stream.events, task)).toBe(false);
  });
});

describe('FILE_FOUND — explicit discovery events', () => {
  const task = {
    id: 't1',
    type: 'FILE_FOUND' as const,
    target: '/home/player/.null/first_contact',
  };

  it('is satisfied by a lab-reported absolute path', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .file('/home/player/.null/first_contact');
    expect(done(stream.events, task)).toBe(true);
  });

  it('resolves a reported relative path against where the player is', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cd .null', '')
      .file('first_contact');
    expect(done(stream.events, task)).toBe(true);
  });

  it('resolves the target itself, so an author may write it with a tilde', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .file('/home/player/.null/first_contact');
    expect(done(stream.events, { ...task, target: '~/.null/first_contact' })).toBe(true);
  });
});

describe('TEXT_FOUND', () => {
  it('is satisfied by text the lab reported', () => {
    const stream = new Stream('ch01-mission-001').started().text('ZERO{the_first_step}');
    expect(
      done(stream.events, { id: 't1', type: 'TEXT_FOUND', target: 'ZERO{the_first_step}' }),
    ).toBe(true);
  });

  it('matches a substring, so surrounding output does not hide it', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat note.txt', 'the answer is ZERO{the_first_step} — keep it safe');
    expect(
      done(stream.events, { id: 't1', type: 'TEXT_FOUND', target: 'ZERO{the_first_step}' }),
    ).toBe(true);
  });

  it('is case-sensitive, because a flag is', () => {
    const stream = new Stream('ch01-mission-001').started().text('zero{the_first_step}');
    expect(
      done(stream.events, { id: 't1', type: 'TEXT_FOUND', target: 'ZERO{the_first_step}' }),
    ).toBe(false);
  });
});

describe('objectives latch and accumulate', () => {
  const two = mission({
    tasks: [
      { id: 'read', type: 'FILE_FOUND', description: 'read it', target: '/home/player/README.txt' },
      { id: 'listen', type: 'PORT_FOUND', description: 'find the port', target: '8080' },
    ],
  });

  it('completes only once both required objectives are met, in whatever order', () => {
    const forwards = new Stream('ch01-mission-001')
      .started()
      .run('cat README.txt', 'hello')
      .port(8080);
    const backwards = new Stream('ch01-mission-001')
      .started()
      .port(8080)
      .run('cat README.txt', 'hello');

    expect(evaluateMission(two, forwards.events).state).toBe('COMPLETED');
    expect(evaluateMission(two, backwards.events).state).toBe('COMPLETED');
  });

  it('reports partial progress while one objective is outstanding', () => {
    const stream = new Stream('ch01-mission-001').started().run('cat README.txt', 'hello');
    const progress = evaluateMission(two, stream.events);
    expect(progress.state).toBe('IN_PROGRESS');
    expect(progress.completedRequiredCount).toBe(1);
    expect(progress.requiredTaskCount).toBe(2);
  });

  it('stamps each objective with the moment it was satisfied, not the end of the session', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat README.txt', 'hello')
      .wait(300)
      .port(8080);
    const progress = evaluateMission(two, stream.events);
    const [read, listen] = progress.tasks;
    expect(read?.completedAt).toBeDefined();
    expect(listen?.completedAt).toBeDefined();
    expect(Date.parse(listen?.completedAt as string)).toBeGreaterThan(
      Date.parse(read?.completedAt as string),
    );
  });

  it('keeps an objective satisfied once met, however the session continues', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('cat README.txt', 'hello')
      .run('cat missing.txt', 'cat: missing.txt: No such file or directory')
      .port(8080);
    expect(evaluateMission(two, stream.events).state).toBe('COMPLETED');
  });
});

describe('a mission with nothing required', () => {
  const bonusOnly = mission({
    tasks: [
      { id: 'b', type: 'COMMAND', description: 'optional', target: 'whoami', optional: true },
    ],
  });

  it('never completes, because completing nothing is not completing', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    const progress = evaluateMission(bonusOnly, stream.events);
    expect(progress.requiredTaskCount).toBe(0);
    expect(progress.state).toBe('IN_PROGRESS');
  });

  it('still records the optional objective, so the authoring mistake is visible', () => {
    const stream = new Stream('ch01-mission-001').started().run('whoami', 'player');
    expect(evaluateMission(bonusOnly, stream.events).tasks[0]?.completed).toBe(true);
  });
});

describe('unknown and malformed objectives', () => {
  it('never satisfies an objective type the engine does not know', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .run('whoami', 'player')
      .port(80)
      .text('x');
    const unknown = mission({
      // Deliberately outside the union: content is data, and data can be wrong.
      tasks: [{ id: 't1', type: 'TELEPATHY' as never, description: 'guess it', target: 'x' }],
    });
    expect(evaluateMission(unknown, stream.events).state).not.toBe('COMPLETED');
  });

  it('ignores events of types no objective reads, rather than failing on them', () => {
    const stream = new Stream('ch01-mission-001')
      .started()
      .achievement('first-blood')
      .completedEvent(900)
      .run('whoami', 'player');
    expect(evaluateMission(mission(), stream.events).state).toBe('COMPLETED');
  });
});
