import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { GameEvent, MissionDefinition } from '@zero-root/types';
import { evaluateMission } from '@zero-root/mission-engine';
import { TerminalRecorder, type RecordedCommand } from '../src/terminal/terminal-recorder';

/**
 * Real bash, replayed.
 *
 * The streams below were captured from an interactive bash on a pseudo-terminal, byte for
 * byte, by pressing the keys a player presses: typing a path, pressing Tab, pressing Up.
 * They are not an idea of what a shell sends — they are what one sent, bracketed-paste
 * markers and all.
 *
 * This is the test that would have caught the bug players actually hit. The objective
 * "There is a file waiting for you in your home directory. Read it." stayed unticked for a
 * player who typed `cat REA` and pressed Tab, because the recorder was reading keystrokes
 * and the shell had run something else. A simulated shell cannot find that: the simulation
 * agrees with whatever the recorder assumes.
 */

const BRACKETED_ON = '\u001b[?2004h';
const BRACKETED_OFF = '\u001b[?2004l';
const PROMPT = 'player@laptop:~$ ';
const FILE_BODY = 'xin chào, người chơi\r\nZERO{the_first_step}\r\n';

/** Captured verbatim: `cd`, then `cat READ` + Tab + Enter. */
const CAPTURED_TAB_COMPLETION =
  '\u001b[?2004hplayer@laptop:~$ cd /tmp/claude-0/home\r\n\u001b[?2004l\r' +
  '\u001b[?2004hplayer@laptop:~$ cat README.txt \r\n\u001b[?2004l\r' +
  'xin chào, người chơi\r\nZERO{the_first_step}\r\n' +
  '\u001b[?2004hplayer@laptop:~$ ';

/** Captured verbatim: `cat README.txt`, then Up + Enter to run it again. */
const CAPTURED_HISTORY_RECALL =
  '\u001b[?2004hplayer@laptop:~$ cd /tmp/claude-0/home\r\n\u001b[?2004l\r' +
  '\u001b[?2004hplayer@laptop:~$ cat README.txt\r\n\u001b[?2004l\r' +
  'xin chào, người chơi\r\nZERO{the_first_step}\r\n' +
  '\u001b[?2004hplayer@laptop:~$ cat README.txt\r\n\u001b[?2004l\r' +
  'xin chào, người chơi\r\nZERO{the_first_step}\r\n' +
  '\u001b[?2004hplayer@laptop:~$ ';

interface Step {
  /** What the player pressed. Absent for the bytes bash sends on attach. */
  readonly keys?: string;
  /** What bash sent back, as the capture recorded it. */
  readonly out: string;
}

const NEW_PROMPT = `\r\n${BRACKETED_OFF}\r${BRACKETED_ON}${PROMPT}`;
const RAN_CAT = `\r\n${BRACKETED_OFF}\r${FILE_BODY}${BRACKETED_ON}${PROMPT}`;

const TAB_COMPLETION_STEPS: readonly Step[] = [
  { out: BRACKETED_ON + PROMPT },
  { keys: 'cd /tmp/claude-0/home', out: 'cd /tmp/claude-0/home' },
  { keys: '\r', out: NEW_PROMPT },
  { keys: 'cat READ', out: 'cat READ' },
  // Tab inserts nothing the player typed; bash completes the name and adds a space.
  { keys: '\t', out: 'ME.txt ' },
  { keys: '\r', out: RAN_CAT },
];

const HISTORY_RECALL_STEPS: readonly Step[] = [
  { out: BRACKETED_ON + PROMPT },
  { keys: 'cd /tmp/claude-0/home', out: 'cd /tmp/claude-0/home' },
  { keys: '\r', out: NEW_PROMPT },
  { keys: 'cat README.txt', out: 'cat README.txt' },
  { keys: '\r', out: RAN_CAT },
  // Up arrow: nothing typed, the whole line arrives as echo.
  { keys: '\u001b[A', out: 'cat README.txt' },
  { keys: '\r', out: RAN_CAT },
];

/** Drives the recorder the way the gateway does: keystrokes out, bytes back, then settle. */
function replay(steps: readonly Step[]): RecordedCommand[] {
  const recorder = new TerminalRecorder();
  const recorded: RecordedCommand[] = [];

  for (const step of steps) {
    if (step.keys !== undefined) recorded.push(...recorder.onInput(step.keys));
    recorder.onOutput(step.out);
  }

  // The gateway's idle timer, which banks the command the player is looking at.
  const settled = recorder.settle();
  if (settled !== null) recorded.push(settled);
  return recorded;
}

describe('the replayed streams are the captured ones', () => {
  it('reassembles the tab-completion capture exactly', () => {
    const joined = TAB_COMPLETION_STEPS.map((step) => step.out).join('');
    expect(joined).toBe(CAPTURED_TAB_COMPLETION);
  });

  it('reassembles the history-recall capture exactly', () => {
    const joined = HISTORY_RECALL_STEPS.map((step) => step.out).join('');
    expect(joined).toBe(CAPTURED_HISTORY_RECALL);
  });
});

describe('a command finished with Tab', () => {
  const recorded = replay(TAB_COMPLETION_STEPS);

  it('records what bash ran, not the few letters that were typed', () => {
    expect(recorded.map((entry) => entry.command)).toEqual([
      'cd /tmp/claude-0/home',
      'cat README.txt',
    ]);
  });

  it('records the file contents as that command output', () => {
    const cat = recorded[1] as RecordedCommand;
    expect(cat.output).toContain('ZERO{the_first_step}');
    expect(cat.truncated).toBe(false);
  });

  it('keeps Vietnamese text intact through the recording', () => {
    expect((recorded[1] as RecordedCommand).output).toContain('xin chào, người chơi');
  });

  it('leaves no bracketed-paste markers in the record', () => {
    for (const entry of recorded) {
      expect(entry.output).not.toContain('2004');
      expect(entry.output).not.toContain('\u001b');
      expect(entry.command).not.toContain('\u001b');
    }
  });
});

describe('a command recalled with the Up arrow', () => {
  const recorded = replay(HISTORY_RECALL_STEPS);

  it('records all three commands, including the one nobody typed', () => {
    expect(recorded.map((entry) => entry.command)).toEqual([
      'cd /tmp/claude-0/home',
      'cat README.txt',
      'cat README.txt',
    ]);
  });

  it('attributes the output to the right run, rather than merging them', () => {
    for (const entry of recorded.slice(1)) {
      expect(entry.output.match(/ZERO\{the_first_step\}/g)).toHaveLength(1);
    }
  });
});

describe('real bash through to the mission engine', () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
  const mission = JSON.parse(
    readFileSync(join(root, 'content/chapters/01-computer/mission-001.json'), 'utf8'),
  ) as MissionDefinition;

  /** The event stream the gateway would have written, from the replayed commands. */
  function events(recorded: readonly RecordedCommand[], home: string): GameEvent[] {
    const base = { sessionId: 'session-1', missionId: mission.id };
    const stream: GameEvent[] = [
      { ...base, type: 'MISSION_STARTED', timestamp: '2026-01-01T12:00:00.000Z' },
    ];
    recorded.forEach((entry, index) => {
      stream.push({
        ...base,
        type: 'COMMAND_EXECUTED',
        command: entry.command,
        cwd: home,
        output: entry.output,
        timestamp: new Date(
          Date.parse('2026-01-01T12:00:00.000Z') + (index + 1) * 1000,
        ).toISOString(),
      });
    });
    return stream;
  }

  it('ticks the read-the-file objective for a player who used Tab', () => {
    // The whole chain: real bash bytes -> recorder -> event stream -> engine -> objective.
    const recorded = replay([
      { out: BRACKETED_ON + PROMPT },
      { keys: 'cat REA', out: 'cat REA' },
      { keys: '\t', out: 'DME.txt ' },
      { keys: '\r', out: RAN_CAT },
    ]);
    const progress = evaluateMission(mission, events(recorded, '/home/player'));
    const read = progress.tasks.find((task) => task.taskId === 'read-readme');
    expect(read?.completed).toBe(true);
  });

  it('ticks it for a player who typed the whole name', () => {
    const recorded = replay([
      { out: BRACKETED_ON + PROMPT },
      { keys: 'cat README.txt', out: 'cat README.txt' },
      { keys: '\r', out: RAN_CAT },
    ]);
    const progress = evaluateMission(mission, events(recorded, '/home/player'));
    expect(progress.tasks.find((task) => task.taskId === 'read-readme')?.completed).toBe(true);
  });

  it('completes the whole mission from one replayed session', () => {
    const recorded = replay([
      { out: BRACKETED_ON + PROMPT },
      { keys: 'whoami', out: 'whoami' },
      { keys: '\r', out: `\r\n${BRACKETED_OFF}\rplayer\r\n${BRACKETED_ON}${PROMPT}` },
      { keys: 'pwd', out: 'pwd' },
      { keys: '\r', out: `\r\n${BRACKETED_OFF}\r/home/player\r\n${BRACKETED_ON}${PROMPT}` },
      { keys: 'cat REA', out: 'cat REA' },
      { keys: '\t', out: 'DME.txt ' },
      { keys: '\r', out: RAN_CAT },
    ]);
    expect(evaluateMission(mission, events(recorded, '/home/player')).state).toBe('COMPLETED');
  });

  it('does not tick it when the read failed', () => {
    const recorded = replay([
      { out: BRACKETED_ON + PROMPT },
      { keys: 'cat README.txt', out: 'cat README.txt' },
      {
        keys: '\r',
        out: `\r\n${BRACKETED_OFF}\rcat: README.txt: No such file or directory\r\n${BRACKETED_ON}${PROMPT}`,
      },
    ]);
    const progress = evaluateMission(mission, events(recorded, '/home/player'));
    expect(progress.tasks.find((task) => task.taskId === 'read-readme')?.completed).toBe(false);
  });
});

describe('bracketed paste, which every modern bash turns on', () => {
  it('does not leak the enable sequence into the command', () => {
    // A player pasting a command arrives wrapped in ESC[200~ ... ESC[201~.
    const recorder = new TerminalRecorder();
    recorder.onOutput(BRACKETED_ON + PROMPT);
    recorder.onInput('\u001b[200~cat README.txt\u001b[201~');
    recorder.onOutput('cat README.txt');
    const completed = recorder.onInput('\r');
    recorder.onOutput(RAN_CAT);
    const settled = recorder.settle();

    expect(completed).toHaveLength(0);
    expect(settled?.command).toBe('cat README.txt');
  });

  it('records the command even when the shell echoes nothing, as a paste into a raw read', () => {
    const recorder = new TerminalRecorder();
    recorder.onInput('\u001b[200~whoami\u001b[201~');
    recorder.onInput('\r');
    recorder.onOutput('player\r\n');
    expect(recorder.settle()?.command).toBe('whoami');
  });
});
