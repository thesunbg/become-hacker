import { basename } from './path.js';

/**
 * Command parsing and matching.
 *
 * A COMMAND objective must recognise what the player meant, not what they typed. `ls -la`,
 * `ls -al`, `ls -l -a` and `ls -la /home/player` are the same discovery, and a mission that
 * only accepts one spelling teaches the player to guess at our parser instead of at the
 * system. So a target describes the *minimum* a command must contain.
 */

export interface ParsedCommand {
  /** Program name with any directory stripped: `/bin/ls` -> `ls`. */
  readonly program: string;
  /** Short flag letters, expanded: `-la` -> {l, a}. */
  readonly shortFlags: ReadonlySet<string>;
  /** Long flags without their values: `--color=auto` -> `color`. */
  readonly longFlags: ReadonlySet<string>;
  /** Everything that is not the program and not a flag. */
  readonly args: readonly string[];
  readonly raw: string;
}

/** Splits a line on shell quoting rules. Unterminated quotes yield the rest of the line. */
export function tokenize(line: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let hasToken = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;

    if (quote) {
      if (char === quote) {
        quote = null;
      } else if (char === '\\' && quote === '"' && i + 1 < line.length) {
        current += line[++i] as string;
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasToken = true;
      continue;
    }
    if (char === '\\' && i + 1 < line.length) {
      current += line[++i] as string;
      hasToken = true;
      continue;
    }
    if (char === ' ' || char === '\t') {
      if (hasToken) {
        tokens.push(current);
        current = '';
        hasToken = false;
      }
      continue;
    }
    current += char;
    hasToken = true;
  }

  if (hasToken) tokens.push(current);
  return tokens;
}

const SEGMENT_SEPARATORS = ['&&', '||', '|', ';'] as const;

/**
 * Splits a command line into independently-executed segments.
 *
 * `cat auth.log | grep -i failed` is two commands, and a mission that asks the player to use
 * `grep` is satisfied by the second one. Separators inside quotes are left alone.
 */
export function splitSegments(line: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const char = line[i] as string;

    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '\\' && i + 1 < line.length) {
      current += char + (line[++i] as string);
      continue;
    }

    const separator = SEGMENT_SEPARATORS.find((sep) => line.startsWith(sep, i));
    if (separator) {
      segments.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0);
}

/** Flags that take a value, so the next token is not a positional argument. */
const FLAGS_WITH_VALUES: Record<string, ReadonlySet<string>> = {
  find: new Set(['name', 'iname', 'type', 'path', 'perm', 'user', 'group', 'size', 'exec']),
  grep: new Set(['e', 'f', 'm', 'A', 'B', 'C']),
  head: new Set(['n', 'c']),
  tail: new Set(['n', 'c']),
};

export function parseCommand(segment: string): ParsedCommand | null {
  const tokens = tokenize(segment);
  // Skip leading `VAR=value` assignments and `sudo`, which prefix the real command.
  let start = 0;
  while (start < tokens.length) {
    const token = tokens[start] as string;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) || token === 'sudo' || token === 'command') {
      start++;
      continue;
    }
    break;
  }
  const programToken = tokens[start];
  if (programToken === undefined) return null;

  const program = basename(programToken);
  const shortFlags = new Set<string>();
  const longFlags = new Set<string>();
  const args: string[] = [];
  const valueFlags = FLAGS_WITH_VALUES[program] ?? new Set<string>();

  for (let i = start + 1; i < tokens.length; i++) {
    const token = tokens[i] as string;

    if (token.startsWith('--') && token.length > 2) {
      const [name = '', ...rest] = token.slice(2).split('=');
      longFlags.add(name);
      if (rest.length === 0 && valueFlags.has(name) && i + 1 < tokens.length) i++;
      continue;
    }
    // `find` uses single-dash long predicates: -name, -type.
    if (token.startsWith('-') && token.length > 2 && program === 'find') {
      const name = token.slice(1);
      longFlags.add(name);
      if (valueFlags.has(name) && i + 1 < tokens.length) {
        args.push(tokens[i + 1] as string);
        i++;
      }
      continue;
    }
    if (token.startsWith('-') && token.length > 1) {
      const letters = token.slice(1);
      for (const letter of letters) shortFlags.add(letter);
      const last = letters[letters.length - 1];
      if (last !== undefined && valueFlags.has(last) && i + 1 < tokens.length) i++;
      continue;
    }
    args.push(token);
  }

  return { program, shortFlags, longFlags, args, raw: segment.trim() };
}

export function parseCommandLine(line: string): ParsedCommand[] {
  return splitSegments(line)
    .map(parseCommand)
    .filter((parsed): parsed is ParsedCommand => parsed !== null);
}

/**
 * Does `actual` contain everything `target` asks for?
 *
 * The target's program must match, and every flag and positional argument it names must be
 * present. Extra flags and arguments on the player's side are fine — exploring further is not
 * a wrong answer.
 */
export function commandSatisfies(target: string, actual: ParsedCommand): boolean {
  const expected = parseCommand(target);
  if (!expected) return false;
  if (expected.program !== actual.program) return false;

  for (const flag of expected.shortFlags) {
    if (!actual.shortFlags.has(flag)) return false;
  }
  for (const flag of expected.longFlags) {
    if (!actual.longFlags.has(flag)) return false;
  }
  for (const arg of expected.args) {
    if (!actual.args.includes(arg)) return false;
  }
  return true;
}

/** True when any segment of the line satisfies the target. */
export function commandLineSatisfies(target: string, line: string): boolean {
  return parseCommandLine(line).some((parsed) => commandSatisfies(target, parsed));
}
