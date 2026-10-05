import type { GameEvent } from '@zero-root/types';
import { parseCommandLine, type ParsedCommand } from './command.js';
import { resolvePath } from './path.js';

/**
 * Turns raw terminal activity into domain discoveries.
 *
 * The player types commands; the engine decides what those commands *found*. This is the
 * layer that makes objectives like FILE_FOUND work without a mission having to describe the
 * command that satisfies it — which is what keeps missions data and not code.
 */

/** Commands whose non-flag arguments are files being read. */
const FILE_READERS: Record<string, { skipArgs: number }> = {
  cat: { skipArgs: 0 },
  tac: { skipArgs: 0 },
  less: { skipArgs: 0 },
  more: { skipArgs: 0 },
  head: { skipArgs: 0 },
  tail: { skipArgs: 0 },
  nl: { skipArgs: 0 },
  strings: { skipArgs: 0 },
  od: { skipArgs: 0 },
  xxd: { skipArgs: 0 },
  // The first argument is the pattern, not a path.
  grep: { skipArgs: 1 },
  egrep: { skipArgs: 1 },
  fgrep: { skipArgs: 1 },
};

const FAILURE_PATTERNS = [
  /no such file or directory/i,
  /permission denied/i,
  /is a directory/i,
  /command not found/i,
  /not a directory/i,
];

/**
 * Did this command fail?
 *
 * Reading a file the player cannot read is not finding it — mission 03 is built entirely on
 * that distinction. When no output was captured we assume success, because treating silence
 * as failure would make objectives undetectable on a quiet command.
 */
export function looksLikeFailure(output: string | undefined): boolean {
  if (output === undefined || output.trim() === '') return false;
  return FAILURE_PATTERNS.some((pattern) => pattern.test(output));
}

/** Tracks `cd` across a session so relative paths resolve the way the player meant them. */
export function applyCd(cwd: string, parsed: ParsedCommand, home: string): string {
  if (parsed.program !== 'cd') return cwd;
  const target = parsed.args[0];
  if (target === undefined || target === '~' || target === '--') return home;
  if (target === '-') return cwd; // previous directory: not tracked, and never an objective
  return resolvePath(cwd, target, home);
}

/** Commands whose output names listening or open ports. */
const PORT_LISTERS = new Set(['ss', 'netstat', 'nmap', 'lsof']);

/**
 * Ports named in the output of a port-listing command.
 *
 * Two formats, because the tools disagree. `nmap` prints the port with its protocol —
 * `8080/tcp open http-proxy` — while `ss` and `netstat` print it on the end of an address:
 * `127.0.0.1:8080`, `0.0.0.0:22`, `[::]:80`. Reading only the first form would make a
 * PORT_FOUND objective undetectable for every player who reached for `ss`, which is the
 * tool actually installed in the labs.
 */
export function portsInOutput(output: string): number[] {
  const found = new Set<number>();

  const add = (raw: string | undefined): void => {
    const port = Number.parseInt(raw ?? '', 10);
    if (Number.isFinite(port) && port > 0 && port <= 65535) found.add(port);
  };

  // nmap: `22/tcp open ssh`.
  for (const match of output.matchAll(/(?:^|[\s:])(\d{1,5})\/(?:tcp|udp)\b/gi)) add(match[1]);
  // ss and netstat: the port closes an address field, so whitespace or the line ends it.
  // The lookahead is what keeps `http://bank.local:8080/admin` out of a port list.
  for (const match of output.matchAll(/:(\d{1,5})(?=\s|$)/gm)) add(match[1]);

  return [...found];
}

export interface DerivedDiscoveries {
  /** Absolute paths the player successfully read. */
  readonly filesRead: readonly string[];
  /** Ports mentioned in the output of a recognised network command. */
  readonly ports: readonly number[];
  /** The working directory *after* this command ran. */
  readonly cwd: string;
}

/**
 * Extracts what a single command line discovered.
 *
 * `cwd` is the directory the command ran in; the returned `cwd` is where the player ended up.
 */
export function observeCommand(
  line: string,
  cwd: string,
  output: string | undefined,
  home = '/home/player',
): DerivedDiscoveries {
  const filesRead: string[] = [];
  const ports: number[] = [];
  let nextCwd = cwd;
  const failed = looksLikeFailure(output);

  for (const parsed of parseCommandLine(line)) {
    nextCwd = applyCd(nextCwd, parsed, home);

    const reader = FILE_READERS[parsed.program];
    if (reader && !failed) {
      for (const arg of parsed.args.slice(reader.skipArgs)) {
        // `-` means stdin, and a glob was expanded by the shell before we saw it.
        if (arg === '-' || arg.includes('*') || arg.includes('?')) continue;
        filesRead.push(resolvePath(cwd, arg, home));
      }
    }

    if (!failed && PORT_LISTERS.has(parsed.program)) {
      for (const port of portsInOutput(output ?? '')) ports.push(port);
    }
  }

  return { filesRead, ports, cwd: nextCwd };
}

/**
 * Folds a recorded event stream into the discoveries it represents.
 *
 * Explicit discovery events (a lab that reports FILE_FOUND itself) are merged with the ones
 * derived from commands, so a mission author can rely on either.
 */
export function observeStream(
  events: readonly GameEvent[],
  home = '/home/player',
): { filesRead: Set<string>; ports: Set<number>; texts: string[]; cwd: string } {
  const filesRead = new Set<string>();
  const ports = new Set<number>();
  const texts: string[] = [];
  let cwd = home;

  for (const event of events) {
    switch (event.type) {
      case 'COMMAND_EXECUTED': {
        const effectiveCwd = event.cwd !== undefined && event.cwd !== '' ? event.cwd : cwd;
        const derived = observeCommand(event.command, effectiveCwd, event.output, home);
        for (const file of derived.filesRead) filesRead.add(file);
        for (const port of derived.ports) ports.add(port);
        if (event.output !== undefined && event.output !== '') texts.push(event.output);
        cwd = derived.cwd;
        break;
      }
      case 'FILE_FOUND':
        filesRead.add(resolvePath(cwd, event.path, home));
        break;
      case 'PORT_DISCOVERED':
        ports.add(event.port);
        break;
      case 'TEXT_FOUND':
        texts.push(event.text);
        break;
      case 'LOG_ANALYSIS':
        texts.push(event.evidence);
        break;
      default:
        break;
    }
  }

  return { filesRead, ports, texts, cwd };
}
