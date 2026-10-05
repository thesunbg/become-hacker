/**
 * Turns a raw terminal byte stream into recorded commands.
 *
 * The player types into a real shell, so there is no structured "command" message to
 * record: the gateway sees keystrokes going one way and bytes coming back the other. This
 * class reconstructs the commands from that, which is what lets the mission engine see
 * COMMAND_EXECUTED events at all.
 *
 * Output is attributed to the command that was running when it arrived. A submitted command
 * is held open while its output streams back, then *settled* — banked as a finished record —
 * when the output goes quiet, when the next command is submitted, or when the session ends.
 *
 * Settling on a quiet period rather than only on the next command matters for the player:
 * an objective should tick when they read the file, not when they happen to type something
 * afterwards. The tradeoff is explicit: a command is settled once, and output arriving after
 * that is forwarded to the player but not added to the record. For the shell commands these
 * missions teach — which answer immediately or not at all — that is the right trade, and it
 * avoids the alternative's bug, where a late error would have to retroactively un-complete an
 * objective that had already been recorded as satisfied.
 *
 * Pure and framework-free, so the awkward cases — backspace, Ctrl+C, arrow keys, a command
 * that prints a megabyte — are unit-testable.
 */

export interface RecordedCommand {
  readonly command: string;
  readonly output: string;
  /** True when output was dropped because the command printed more than we will hold. */
  readonly truncated: boolean;
}

/** A single command's output is capped: `yes` must not be able to exhaust the API's memory. */
export const MAX_OUTPUT_CHARS = 64 * 1024;
/** A pathological input line is capped too. */
export const MAX_LINE_CHARS = 4 * 1024;
/** Only the tail of the echo matters — the line being typed — so the rest can be dropped. */
export const MAX_ECHO_CHARS = 8 * 1024;

const CTRL_C = '\u0003';
const CTRL_U = '\u0015';
const CTRL_W = '\u0017';
const BACKSPACE = '\u007f';
const BACKSPACE_ALT = '\b';
const ESCAPE = '\u001b';
const TAB = '\t';

/**
 * Removes ANSI escape sequences and the control bytes that cannot be stored.
 *
 * PostgreSQL's json type rejects \u0000 outright, so a command that prints binary — `cat` on
 * an executable, `strings`, `head` on an image — would make the event insert throw and that
 * command would vanish from the record. Carriage return, newline and tab are kept: they are
 * the shape of the output, not noise.
 */
export function stripAnsi(text: string): string {
  // CSI sequences, OSC strings, and lone two-character escapes.
  return (
    text
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
      .replace(/\u001b[@-Z\\-_]/g, '')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

/** True when every character of `needle` appears in `haystack`, in order. */
function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (index < needle.length && char === needle[index]) index++;
  }
  return index === needle.length;
}

export class TerminalRecorder {
  private line = '';
  private pendingCommand: string | null = null;
  private buffer = '';
  private truncated = false;
  private settled = false;
  private escape: 'none' | 'after-esc' | 'csi' | 'osc' = 'none';
  /** Everything the shell has echoed since the last command was submitted. */
  private echo = '';

  /**
   * Feeds keystrokes from the player.
   *
   * Returns any command that is now complete — that is, the previous command, whose output
   * has finished arriving because a new one has just been submitted.
   */
  onInput(data: string): RecordedCommand[] {
    const completed: RecordedCommand[] = [];

    for (const char of data) {
      // Arrow keys, Home/End and friends arrive as escape sequences and must not become
      // text. Note that a CSI sequence's introducer `[` is itself inside the final-byte
      // range, so the parameter bytes have to be consumed in their own state — treating any
      // byte in `@`..`~` as the terminator would end `ESC [ A` at the `[` and leak the `A`.
      if (this.escape !== 'none') {
        this.consumeEscape(char);
        continue;
      }

      switch (char) {
        case ESCAPE:
          this.escape = 'after-esc';
          break;

        case '\r':
        case '\n': {
          const typed = this.line.trim();
          const submitted = this.commandFromEcho(typed) ?? typed;
          this.line = '';
          this.echo = '';
          if (submitted === '') break;

          const finished = this.submit(submitted);
          if (finished !== null) completed.push(finished);
          break;
        }

        case BACKSPACE:
        case BACKSPACE_ALT:
          this.line = this.line.slice(0, -1);
          break;

        case CTRL_C:
        case CTRL_U:
          // Ctrl+C abandons the line; so does Ctrl+U. Neither is a command.
          this.line = '';
          break;

        case CTRL_W:
          this.line = this.line.replace(/\s*\S*$/, '');
          break;

        case TAB:
          // Completion happens in the shell, where we cannot see what it inserted. Ignoring
          // the tab keeps the reconstructed line honest rather than subtly wrong.
          break;

        default:
          if (char >= ' ' && this.line.length < MAX_LINE_CHARS) this.line += char;
          break;
      }
    }

    return completed;
  }

  /**
   * Reconstructs the command from what the shell echoed back.
   *
   * Keystrokes alone are not what the shell will run. Tab completion turns `cat REA` into
   * `cat README.txt`, and pressing Up recalls a whole command without a single character
   * being typed — both are how people actually use a shell, and reading the keystrokes
   * silently misses the first and records nothing at all for the second. The shell is the
   * authority on its own input, and it tells us by echoing.
   *
   * The command is whatever follows the last prompt marker on the current line. `typed` is
   * the sanity check: every character the player pressed must appear, in order, within the
   * candidate, because completion and recall only ever produce a superset of what was typed.
   * Where that does not hold — a command containing a literal `$ `, say — the typed line is
   * trusted instead.
   */
  private commandFromEcho(typed: string): string | null {
    // A lone carriage return starts a line too, not only CRLF. Every bash that enables
    // bracketed paste ends its reset with `ESC[?2004l\r`, so from the second command of a
    // session onwards the echo's last line begins with a bare CR — and `.` in a JavaScript
    // regex never matches one. Splitting only on newlines left the prompt unmatchable there,
    // which silently reduced every command after the first to the keystrokes behind it: a
    // Tab-completed or recalled command was recorded as the fragment that was typed, and the
    // objective it satisfied never ticked.
    const lines = stripAnsi(this.echo).split(/\r\n|\r|\n/);
    const lastLine = lines[lines.length - 1] ?? '';

    // Greedy, so it finds the *last* prompt on the line.
    const match = /^.*[$#>]\s(.*)$/.exec(lastLine);
    if (match === null) return null;

    const candidate = (match[1] ?? '').trim();
    if (candidate === '' || !isSubsequence(typed, candidate)) return null;
    return candidate;
  }

  /** Advances the escape-sequence state machine by one byte. */
  private consumeEscape(char: string): void {
    switch (this.escape) {
      case 'after-esc':
        if (char === '[') this.escape = 'csi';
        else if (char === ']') this.escape = 'osc';
        else if (char === 'O')
          this.escape = 'csi'; // SS3: application-mode arrow keys
        else this.escape = 'none'; // a two-byte escape, already complete
        break;

      case 'csi':
        // Parameter bytes `0-9;:<=>?` and intermediates ` -/` continue the sequence; any
        // byte in `@`..`~` is the final one.
        if (/[\x40-\x7e]/.test(char) && !/[0-9;:<=>?]/.test(char)) this.escape = 'none';
        break;

      case 'osc':
        // Terminated by BEL, or by ST which begins with ESC.
        if (char === '\u0007' || char === ESCAPE) this.escape = 'none';
        break;

      default:
        this.escape = 'none';
        break;
    }
  }

  private submit(command: string): RecordedCommand | null {
    const finished = this.settle();

    this.pendingCommand = command;
    this.buffer = '';
    this.truncated = false;
    this.settled = false;
    this.echo = '';
    return finished;
  }

  /** Feeds bytes coming back from the container. */
  onOutput(data: string): void {
    // Collected unconditionally, including before the first command: the prompt and the echo
    // of the line being typed both arrive this way, and `commandFromEcho` needs them.
    this.echo = (this.echo + data).slice(-MAX_ECHO_CHARS);

    // Before the first command there is only the shell banner; after settling, the record
    // for that command is already closed.
    if (this.pendingCommand === null || this.settled) return;

    const room = MAX_OUTPUT_CHARS - this.buffer.length;
    if (room <= 0) {
      this.truncated = true;
      return;
    }
    if (data.length > room) {
      this.buffer += data.slice(0, room);
      this.truncated = true;
      return;
    }
    this.buffer += data;
  }

  /**
   * Banks the command in flight, if there is one that has not been banked already.
   *
   * Call this when output has gone quiet. Settling twice returns null the second time, so an
   * idle timer firing repeatedly records nothing extra.
   */
  settle(): RecordedCommand | null {
    if (this.pendingCommand === null || this.settled) return null;
    this.settled = true;
    return {
      command: this.pendingCommand,
      output: stripAnsi(this.buffer),
      truncated: this.truncated,
    };
  }

  /** Closes out the session, banking the command still in flight. */
  flush(): RecordedCommand | null {
    const finished = this.settle();
    this.pendingCommand = null;
    this.buffer = '';
    this.truncated = false;
    this.settled = false;
    return finished;
  }

  /** True when a command is open and still collecting output. For tests and idle timers. */
  get hasUnsettledCommand(): boolean {
    return this.pendingCommand !== null && !this.settled;
  }

  /** The line the player is currently typing. Exposed for tests only. */
  get currentLine(): string {
    return this.line;
  }
}
