/**
 * A tiny POSIX path resolver.
 *
 * Hand-rolled rather than `node:path` because this package is bundled into the browser as
 * well as run on the server, and because the engine must stay free of platform behaviour:
 * a mission's expected path should resolve identically everywhere.
 */

/** Collapses `.` and `..` segments. Does not touch the filesystem — there isn't one here. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith('/');
  const out: string[] = [];

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') {
        out.pop();
      } else if (!absolute) {
        out.push('..');
      }
      continue;
    }
    out.push(segment);
  }

  const joined = out.join('/');
  if (absolute) return `/${joined}`;
  return joined === '' ? '.' : joined;
}

/**
 * Resolves `target` against `cwd`, expanding a leading `~` to `home`.
 *
 * `resolvePath('/home/player', '.null/first_contact')` -> `/home/player/.null/first_contact`
 */
export function resolvePath(cwd: string, target: string, home = '/home/player'): string {
  if (target === '~') return normalizePath(home);
  if (target.startsWith('~/')) return normalizePath(`${home}/${target.slice(2)}`);
  if (target.startsWith('/')) return normalizePath(target);
  return normalizePath(`${cwd}/${target}`);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}
