# 04 — Mission Format & Engine

## The data-driven rule

> **Adding a new mission must mean adding content, not changing application code.**

Missions are **never** hard-coded in React or in the API. They live as JSON under `content/`:

```
content/chapters/
  01-computer/mission-001.json … mission-010.json
  02-network/ mission-011.json … mission-020.json
  03-web/     mission-021.json … mission-030.json
content/assets/
```

The canonical JSON Schema is [`content/mission.schema.json`](../content/mission.schema.json);
`pnpm content:validate` checks every mission file against it.

## Mission schema

```json
{
  "id": "ch01-mission-001",
  "chapter": 1,
  "title": "Welcome",
  "difficulty": 1,
  "estimatedMinutes": 10,

  "story": "...",
  "objective": "...",

  "environment": { "type": "terminal", "image": "linux-basic" },

  "tasks": [],
  "hints": [],
  "flag": "...",
  "knowledge": [],
  "skills": [],
  "xp": 100
}
```

Field notes:

- `environment.image` names a directory under `labs/` — the sandbox this mission runs in.
- `flag` is **server-side only**. It must never be serialised into any client response; see
  [06-security.md](06-security.md). It is required when the mission has a `FLAG_FOUND` task and
  omitted otherwise — missions that complete purely through tasks (like mission 001) do not get
  a decorative flag, and a flag no task asks for is a validation error.
- `knowledge` is what the post-mission review teaches, and should include the real-world mapping.
- `skills` is a list of `{ skill, amount }` deltas applied on completion.

## Objective types

A task's `type` tells the engine how to detect progress:

```
COMMAND              a specific command (or shape of command) was run
FILE_FOUND           a target path was read/located
TEXT_FOUND           a string was surfaced in output
PORT_FOUND           a port was discovered
HTTP_REQUEST         a request with given properties was made
FLAG_FOUND           the flag value appeared
ANSWER               a free-form answer matched
CONFIG_CHANGED       a config reached a target state
SERVICE_DISCOVERED   a service was identified
LOG_ANALYSIS         the relevant log event was isolated
```

Example:

```json
{ "type": "FILE_FOUND", "target": "/home/player/.secret" }
```

## Mission state machine

```
LOCKED → AVAILABLE → STARTED → IN_PROGRESS → COMPLETED
```

Optional terminal states: `FAILED`, `ABANDONED`.

## The mission engine

A single generic engine in `packages/mission-engine`, framework-free and heavily unit-tested.
Responsibilities:

```
load mission · create session · track objectives · validate actions
calculate score · unlock hints · complete mission · award XP
```

It is a pure function of (mission definition, event stream, player state) → (progress, score,
rewards). Keeping it pure is what makes it testable and what keeps scoring on the server.

## Languages

Translations are data too. Adding a language means adding files under
`content/i18n/<locale>/`, never editing a component or an API module:

```
content/i18n/vi/
  chapters.json          chapter titles, keyed by chapter number
  ch01-mission-001.json  one file per mission
```

A translation carries **text only**:

```json
{
  "missionId": "ch01-mission-001",
  "title": "Khởi đầu",
  "story": "...",
  "objective": "...",
  "tasks": { "identify-user": "..." },
  "hints": { "1": "...", "2": "..." },
  "knowledge": [{ "concept": "...", "explanation": "...", "realWorld": "..." }]
}
```

The canonical mission stays the only source of everything that decides whether a player is
right — the flag, every task `target`, every id, every XP value. `localiseMission` reads a
whitelist of text fields and nothing else, so **a translation cannot change an answer**, unlock
a mission, or make a hint cheaper. `pnpm content:validate` rejects a translation file that
names a flag, a target or an id, and reports one that has drifted out of alignment with the
mission it translates.

Untranslated fields fall back to the original one by one, so a half-finished language shows
translated text where it exists and English everywhere else rather than blanks. The validator
warns about what is still missing.

The interface has its own dictionary in `apps/web/src/i18n/`, typed against English, so a
language missing a string is a compile error rather than a blank space in production. The
client sends its choice as `x-locale`; the API honours that first and the browser's
`Accept-Language` second.

**Known gap:** the files inside a lab image — `README.txt`, `.null/first_contact` — are part of
the sandbox filesystem, not of the mission JSON, and are still English in every language.
Localising them means per-locale lab images, which also changes what a mission's `target`
points at. Command output being English is realistic; the story files are not, so this is worth
doing properly rather than quickly.

## Event system

Every meaningful player action emits an event. Events are the engine's only input, and the
audit trail for anti-cheat.

```json
{
  "type": "COMMAND_EXECUTED",
  "command": "ls -la",
  "missionId": "ch01-m02",
  "timestamp": "..."
}
```

```
MISSION_STARTED · COMMAND_EXECUTED · FILE_FOUND · PORT_DISCOVERED · HTTP_REQUEST
HINT_USED · FLAG_SUBMITTED · MISSION_COMPLETED · MISSION_FAILED · ACHIEVEMENT_UNLOCKED
```
