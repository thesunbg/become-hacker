import { describe, expect, it } from 'vitest';
import {
  commandLineSatisfies,
  commandSatisfies,
  parseCommand,
  parseCommandLine,
  splitSegments,
  tokenize,
} from '../src/command.js';

describe('tokenize', () => {
  it('splits on whitespace', () => {
    expect(tokenize('ls -la /home')).toEqual(['ls', '-la', '/home']);
  });

  it('keeps double-quoted strings together', () => {
    expect(tokenize('grep "failed login" auth.log')).toEqual(['grep', 'failed login', 'auth.log']);
  });

  it('keeps single-quoted strings together', () => {
    expect(tokenize("grep 'a b' f")).toEqual(['grep', 'a b', 'f']);
  });

  it('honours escaped spaces', () => {
    expect(tokenize('cat my\\ file.txt')).toEqual(['cat', 'my file.txt']);
  });

  it('preserves an empty quoted argument', () => {
    expect(tokenize('grep "" file')).toEqual(['grep', '', 'file']);
  });

  it('tolerates collapsing whitespace', () => {
    expect(tokenize('  ls   -l  ')).toEqual(['ls', '-l']);
  });
});

describe('splitSegments', () => {
  it('splits a pipeline', () => {
    expect(splitSegments('cat auth.log | grep failed')).toEqual(['cat auth.log', 'grep failed']);
  });

  it('splits on all the shell operators', () => {
    expect(splitSegments('a && b || c ; d')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not split on an operator inside quotes', () => {
    expect(splitSegments('grep "a|b" file')).toEqual(['grep "a|b" file']);
  });
});

describe('parseCommand', () => {
  it('expands bundled short flags', () => {
    const parsed = parseCommand('ls -la');
    expect(parsed?.program).toBe('ls');
    expect([...(parsed?.shortFlags ?? [])].sort()).toEqual(['a', 'l']);
  });

  it('strips a directory from the program name', () => {
    expect(parseCommand('/bin/ls -a')?.program).toBe('ls');
  });

  it('ignores a sudo prefix so the real command is still recognised', () => {
    expect(parseCommand('sudo cat /etc/shadow')?.program).toBe('cat');
  });

  it('ignores leading environment assignments', () => {
    expect(parseCommand('LANG=C grep secret file')?.program).toBe('grep');
  });

  it('separates long flags from their values', () => {
    const parsed = parseCommand('ls --color=auto --all');
    expect([...(parsed?.longFlags ?? [])].sort()).toEqual(['all', 'color']);
    expect(parsed?.args).toEqual([]);
  });

  it('treats find predicates as long flags and keeps their values as arguments', () => {
    const parsed = parseCommand('find / -name .secret -type f');
    expect([...(parsed?.longFlags ?? [])].sort()).toEqual(['name', 'type']);
    expect(parsed?.args).toEqual(['/', '.secret', 'f']);
  });

  it('does not mistake a flag value for a positional argument', () => {
    // -n takes a count, so `5` is not a file.
    expect(parseCommand('head -n 5 auth.log')?.args).toEqual(['auth.log']);
  });

  it('returns null for an empty line', () => {
    expect(parseCommand('   ')).toBeNull();
  });
});

describe('commandSatisfies', () => {
  const satisfies = (target: string, actual: string): boolean =>
    commandSatisfies(target, parseCommand(actual)!);

  it('accepts an exact match', () => {
    expect(satisfies('whoami', 'whoami')).toBe(true);
  });

  it('rejects a different program', () => {
    expect(satisfies('whoami', 'pwd')).toBe(false);
  });

  it('accepts flags given in any order', () => {
    expect(satisfies('ls -la', 'ls -al')).toBe(true);
  });

  it('accepts flags given separately', () => {
    expect(satisfies('ls -la', 'ls -l -a')).toBe(true);
  });

  it('accepts extra arguments beyond what was asked for', () => {
    expect(satisfies('ls -la', 'ls -la /home/player')).toBe(true);
  });

  it('rejects a missing flag', () => {
    expect(satisfies('ls -la', 'ls -l')).toBe(false);
  });

  it('accepts any invocation when the target names only the program', () => {
    expect(satisfies('find', 'find / -name .secret')).toBe(true);
  });

  it('requires a positional argument the target names', () => {
    expect(satisfies('cat README.txt', 'cat notes.txt')).toBe(false);
    expect(satisfies('cat README.txt', 'cat README.txt')).toBe(true);
  });
});

describe('commandLineSatisfies', () => {
  it('matches a command anywhere in a pipeline', () => {
    expect(commandLineSatisfies('grep', 'cat auth.log | grep -i failed')).toBe(true);
  });

  it('matches a command after a chaining operator', () => {
    expect(commandLineSatisfies('pwd', 'whoami && pwd')).toBe(true);
  });

  it('does not match a program that never appears', () => {
    expect(commandLineSatisfies('env', 'cat auth.log | grep failed')).toBe(false);
  });

  it('parses every segment of a pipeline', () => {
    expect(parseCommandLine('cat a | grep b | wc -l').map((c) => c.program)).toEqual([
      'cat',
      'grep',
      'wc',
    ]);
  });
});
