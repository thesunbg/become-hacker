import { describe, expect, it } from 'vitest';
import { MAX_OUTPUT_CHARS, TerminalRecorder, stripAnsi } from '../src/terminal/terminal-recorder';

describe('stripAnsi', () => {
  it('removes colour codes so text matching sees what the player sees', () => {
    expect(stripAnsi('\u001b[01;32mplayer\u001b[00m@laptop')).toBe('player@laptop');
  });

  it('removes cursor movement', () => {
    expect(stripAnsi('a\u001b[2K\u001b[1Ab')).toBe('ab');
  });

  it('removes an OSC title sequence', () => {
    expect(stripAnsi('\u001b]0;terminal title\u0007hello')).toBe('hello');
  });

  it('leaves ordinary text alone, flag braces included', () => {
    expect(stripAnsi('ZR{h1dd3n_1n_pl41n_s1ght}')).toBe('ZR{h1dd3n_1n_pl41n_s1ght}');
  });
});

describe('TerminalRecorder — assembling a line from keystrokes', () => {
  const type = (recorder: TerminalRecorder, text: string): void => {
    for (const char of text) recorder.onInput(char);
  };

  it('assembles a command typed one character at a time', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'whoami');
    expect(recorder.currentLine).toBe('whoami');
  });

  it('honours backspace', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'whoamii\u007f');
    expect(recorder.currentLine).toBe('whoami');
  });

  it('honours the alternative backspace byte', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'pwdx\b');
    expect(recorder.currentLine).toBe('pwd');
  });

  it('discards the line on Ctrl+C, which is not a command', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'rm -rf /\u0003');
    expect(recorder.currentLine).toBe('');
  });

  it('clears the line on Ctrl+U', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'some long line\u0015');
    expect(recorder.currentLine).toBe('');
  });

  it('deletes a word on Ctrl+W', () => {
    const recorder = new TerminalRecorder();
    type(recorder, 'ls -la /home\u0017');
    expect(recorder.currentLine).toBe('ls -la');
  });

  it('does not turn arrow keys into text', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls\u001b[A\u001b[B\u001b[C\u001b[D');
    expect(recorder.currentLine).toBe('ls');
  });

  it('does not turn application-mode arrow keys into text', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls\u001bOA\u001bOB');
    expect(recorder.currentLine).toBe('ls');
  });

  it('survives a parameterised sequence such as Home, End or a mouse report', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls\u001b[1;5H\u001b[200~\u001b[3~');
    expect(recorder.currentLine).toBe('ls');
  });

  it('handles an escape sequence split across two chunks', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls\u001b');
    recorder.onInput('[A');
    expect(recorder.currentLine).toBe('ls');
  });

  it('ignores a two-byte escape without swallowing what follows', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('l\u001b7s');
    expect(recorder.currentLine).toBe('ls');
  });

  it('ignores tab, because the shell completes where we cannot see it', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('cat READ\t');
    expect(recorder.currentLine).toBe('cat READ');
  });

  it('ignores a bare Enter', () => {
    const recorder = new TerminalRecorder();
    expect(recorder.onInput('\r')).toEqual([]);
    expect(recorder.onInput('   \r')).toEqual([]);
  });

  it('caps a pathological input line', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('a'.repeat(100_000));
    expect(recorder.currentLine.length).toBeLessThanOrEqual(4096);
  });

  it('accepts a whole paste at once', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls -la /home/player');
    expect(recorder.currentLine).toBe('ls -la /home/player');
  });
});

describe('TerminalRecorder — how people actually use a shell', () => {
  const PROMPT = 'player@laptop:~$ ';

  /** Plays a session the way a PTY does: the shell echoes everything back. */
  function session() {
    const recorder = new TerminalRecorder();
    recorder.onOutput(PROMPT);
    return {
      recorder,
      /** Types characters; the shell echoes each one. */
      type(text: string) {
        for (const char of text) {
          recorder.onInput(char);
          recorder.onOutput(char);
        }
      },
      /** Presses Tab; the shell echoes the rest of the completion. */
      tab(completion: string) {
        recorder.onInput('\t');
        recorder.onOutput(completion);
      },
      /** Presses Up; the shell echoes the whole recalled command. */
      up(recalled: string) {
        recorder.onInput('\u001b[A');
        recorder.onOutput(recalled);
      },
      enter() {
        const done = recorder.onInput('\r');
        recorder.onOutput('\r\n');
        return done;
      },
    };
  }

  it('records the completed command when Tab was used, not the few letters typed', () => {
    // This is what broke mission 01 in practice: `cat REA<Tab>` reads the file, and the
    // objective never ticked because `cat REA` was what got recorded.
    const s = session();
    s.type('cat REA');
    s.tab('DME.txt');
    s.enter();
    s.recorder.onOutput('If you are reading this…\r\n' + PROMPT);

    expect(s.recorder.settle()?.command).toBe('cat README.txt');
  });

  it('records a command recalled with the Up arrow, which types nothing at all', () => {
    const s = session();
    s.up('cat README.txt');
    s.enter();
    s.recorder.onOutput('If you are reading this…\r\n' + PROMPT);

    expect(s.recorder.settle()?.command).toBe('cat README.txt');
  });

  it('records a plain typed command unchanged', () => {
    const s = session();
    s.type('whoami');
    s.enter();
    s.recorder.onOutput('player\r\n' + PROMPT);

    expect(s.recorder.settle()?.command).toBe('whoami');
  });

  it('keeps working for the second command, after a prompt has been reprinted', () => {
    const s = session();
    s.type('whoami');
    s.enter();
    s.recorder.onOutput('player\r\n' + PROMPT);
    s.recorder.settle();

    s.type('ls -');
    s.tab('la');
    s.enter();
    s.recorder.onOutput('README.txt\r\n' + PROMPT);

    expect(s.recorder.settle()?.command).toBe('ls -la');
  });

  it('honours a backspace that the shell echoed away', () => {
    const s = session();
    s.type('cat READMEX');
    s.recorder.onInput('\u007f');
    s.recorder.onOutput('\b \b');
    s.recorder.onInput('.');
    s.recorder.onOutput('.');
    s.type('txt');
    s.enter();

    // The echo still contains the backspaced characters, so the typed line wins the check.
    expect(s.recorder.settle()?.command).toContain('cat README');
  });

  it('trusts the typed line when the command itself contains a prompt-like marker', () => {
    const s = session();
    s.type('echo "costs $ 5"');
    s.enter();
    s.recorder.onOutput('costs $ 5\r\n' + PROMPT);

    // Splitting on the last `$ ` would give `5"`, which the typed line is not a subsequence
    // of, so the keystrokes are used instead.
    expect(s.recorder.settle()?.command).toBe('echo "costs $ 5"');
  });

  it('falls back to the keystrokes when nothing was echoed at all', () => {
    // A shell with echo off, or output that has not arrived yet.
    const recorder = new TerminalRecorder();
    recorder.onInput('whoami\r');
    recorder.onOutput('player');

    expect(recorder.settle()?.command).toBe('whoami');
  });

  it('still ignores a bare Enter at an empty prompt', () => {
    const s = session();
    expect(s.enter()).toEqual([]);
  });
});

describe('TerminalRecorder — attributing output to commands', () => {
  it('banks a command with the output that followed it', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('whoami\r');
    recorder.onOutput('player\r\n');

    const settled = recorder.settle();
    expect(settled?.command).toBe('whoami');
    expect(settled?.output).toContain('player');
  });

  it('ignores the shell banner printed before any command', () => {
    const recorder = new TerminalRecorder();
    recorder.onOutput('player@laptop:~$ ');
    expect(recorder.settle()).toBeNull();
  });

  it('settles only once, so a repeating idle timer records nothing extra', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('pwd\r');
    recorder.onOutput('/home/player\r\n');

    expect(recorder.settle()).not.toBeNull();
    expect(recorder.settle()).toBeNull();
    expect(recorder.settle()).toBeNull();
  });

  it('banks the previous command when a new one is submitted unsettled', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('whoami\r');
    recorder.onOutput('player\r\n');

    const completed = recorder.onInput('pwd\r');
    expect(completed).toHaveLength(1);
    expect(completed[0]?.command).toBe('whoami');
    expect(completed[0]?.output).toContain('player');
  });

  it('does not re-bank a command that has already settled', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('whoami\r');
    recorder.onOutput('player\r\n');
    recorder.settle();

    expect(recorder.onInput('pwd\r')).toEqual([]);
  });

  it('does not mix one command output into the next', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('whoami\r');
    recorder.onOutput('player\r\n');
    recorder.settle();

    recorder.onInput('pwd\r');
    recorder.onOutput('/home/player\r\n');
    const second = recorder.settle();

    expect(second?.command).toBe('pwd');
    expect(second?.output).not.toContain('player\r\n/home');
    expect(second?.output).toContain('/home/player');
  });

  it('banks an error, so a failed read is recorded as a failure', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('cat .secret\r');
    recorder.onOutput('cat: .secret: No such file or directory\r\n');

    expect(recorder.settle()?.output).toContain('No such file or directory');
  });

  it('strips escape codes from the recorded output', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('ls\r');
    recorder.onOutput('\u001b[01;34mREADME.txt\u001b[0m\r\n');

    expect(recorder.settle()?.output).toBe('README.txt\r\n');
  });

  it('caps a command that floods output, and says it was truncated', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('yes\r');
    for (let i = 0; i < 100; i++) recorder.onOutput('y\r\n'.repeat(5_000));

    const settled = recorder.settle();
    expect(settled?.output.length).toBeLessThanOrEqual(MAX_OUTPUT_CHARS);
    expect(settled?.truncated).toBe(true);
  });

  it('banks a command with no output at all', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('cd .null\r');
    const settled = recorder.settle();
    expect(settled?.command).toBe('cd .null');
    expect(settled?.output).toBe('');
  });

  it('reports whether anything is waiting to be banked', () => {
    const recorder = new TerminalRecorder();
    expect(recorder.hasUnsettledCommand).toBe(false);
    recorder.onInput('whoami\r');
    expect(recorder.hasUnsettledCommand).toBe(true);
    recorder.settle();
    expect(recorder.hasUnsettledCommand).toBe(false);
  });

  it('banks the command in flight when the session ends', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('cat README.txt\r');
    recorder.onOutput('If you are reading this...');

    const flushed = recorder.flush();
    expect(flushed?.command).toBe('cat README.txt');
    expect(flushed?.output).toContain('If you are reading this');
    expect(recorder.flush()).toBeNull();
  });
});
