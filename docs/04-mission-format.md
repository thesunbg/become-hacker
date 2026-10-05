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
