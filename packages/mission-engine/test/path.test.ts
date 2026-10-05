import { describe, expect, it } from 'vitest';
import { basename, normalizePath, resolvePath } from '../src/path.js';

describe('normalizePath', () => {
  it('collapses redundant separators and dots', () => {
    expect(normalizePath('/home//player/./docs')).toBe('/home/player/docs');
  });

  it('resolves parent segments', () => {
    // POSIX: `..` pops the segment before it, so this lands beside `player`, not at the root.
    expect(normalizePath('/home/player/../root')).toBe('/home/root');
    expect(normalizePath('/home/player/../../etc')).toBe('/etc');
  });

  it('cannot escape above the filesystem root', () => {
    expect(normalizePath('/../../etc/passwd')).toBe('/etc/passwd');
  });

  it('keeps leading parents on a relative path, where they are still meaningful', () => {
    expect(normalizePath('../sibling')).toBe('../sibling');
  });

  it('represents an emptied relative path as the current directory', () => {
    expect(normalizePath('a/..')).toBe('.');
  });
});

describe('resolvePath', () => {
  const home = '/home/player';

  it('resolves a relative path against the working directory', () => {
    expect(resolvePath(home, '.null/first_contact', home)).toBe('/home/player/.null/first_contact');
  });

  it('leaves an absolute path alone', () => {
    expect(resolvePath('/tmp', '/etc/passwd', home)).toBe('/etc/passwd');
  });

  it('expands a lone tilde to home', () => {
    expect(resolvePath('/tmp', '~', home)).toBe('/home/player');
  });

  it('expands a tilde prefix', () => {
    expect(resolvePath('/tmp', '~/notes.txt', home)).toBe('/home/player/notes.txt');
  });

  it('agrees on the same file reached two different ways', () => {
    expect(resolvePath('/home/player/.null', '../README.txt', home)).toBe(
      resolvePath('/home/player', 'README.txt', home),
    );
  });
});

describe('basename', () => {
  it('strips a directory prefix', () => {
    expect(basename('/usr/bin/ls')).toBe('ls');
  });

  it('passes through a bare name', () => {
    expect(basename('whoami')).toBe('whoami');
  });
});
