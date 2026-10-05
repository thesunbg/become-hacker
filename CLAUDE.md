# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**ZERO → ROOT** — a story-driven web game that teaches cybersecurity by making players
investigate rather than read. Real terminal, isolated sandboxes, no answers handed over.

The full specification lives in [`docs/`](docs/README.md); start at `docs/README.md`. Two
documents constrain everything else:

- **[`docs/06-security.md`](docs/06-security.md)** — sandbox and isolation rules. Non-negotiable.
- **[`docs/07-roadmap.md`](docs/07-roadmap.md)** — what to build now, and what not to build yet.

## Current state

Pre-MVP. The repo holds the spec, monorepo scaffolding, the mission content format with
missions 001–002 authored as data, and the `linux-basic` lab image. **No application code exists
yet.** The next step is Vertical Slice #1 (`docs/07-roadmap.md`).

## Commands

```bash
pnpm install
pnpm dev                 # turbo run dev across apps
pnpm build
pnpm test
pnpm lint
pnpm typecheck
pnpm content:validate    # validate mission JSON — dependency-free, works in a bare checkout
pnpm infra:up            # postgres + redis via docker compose
pnpm infra:down
```

`pnpm content:validate` is the one check that runs without `pnpm install`. Run it after touching
anything under `content/`.

## Stack

React · TypeScript · Vite · Tailwind · xterm.js · Zustand · React Router on the front;
NestJS · Prisma · PostgreSQL · Redis on the back; pnpm workspaces + Turborepo; WebSocket for
the terminal. TypeScript strict mode everywhere.

## Architecture rules that are easy to break by accident

**1. Missions are data, not code.** Adding a mission must mean adding a JSON file under
`content/chapters/`, never editing a React component or an API module. If a mission needs
application changes, the generic capability is missing from `packages/mission-engine` — add it
there.

**2. The mission engine is pure.** `packages/mission-engine` is framework-free: given a mission
definition, an event stream and player state, it returns progress, score and rewards. No I/O, no
Nest decorators, no database. That is what makes it unit-testable, and unit tests for it are
required.

**3. Never trust the client.** Mission completion, flags, XP, achievements and lab state are all
validated server-side from the recorded event stream. A request like
`POST /mission/complete {"score": 1000}` must be impossible, not merely discouraged.

**4. Flags are server-side only.** A mission's `flag` must never be serialised into a client
response — not in a mission payload, not in a debug field, not in a source map. When adding a
mission DTO, confirm the flag is stripped.

**5. XP is a ledger.** Never store `user.xp = 1000`. Append to `xp_transactions` and derive the
total. This is what makes cheating detectable and bugs diagnosable.

**6. Player commands never execute on the host.** Nothing resembling `exec(command)` on the API
process, ever. Commands only run inside a disposable lab container, reached through
`Browser → WebSocket → Terminal Gateway → Lab Manager → Sandbox`. The Docker socket is never
exposed to the browser or to the API's public surface.

**7. Labs are isolated by construction.** No privileged containers, no host bind mounts, no
route to the internet or to production. Every lab gets CPU, memory, PID and time limits. These
are not tunable conveniences — see `docs/06-security.md` before changing any of them.

## Content safety

All exercises target environments that are **intentionally vulnerable, isolated and game-owned**
(`bank.local`, `shop.local`, and similar fake domains). Never add content that asks a player to
attack a real website, address, company or service, and never add a capability that would let
them. Deliberate vulnerabilities in `labs/` are part of the curriculum and exist to be
understood and then defended; keep them inside the sandbox.

## Writing missions

Schema: [`content/mission.schema.json`](content/mission.schema.json). Format and objective types:
[`docs/04-mission-format.md`](docs/04-mission-format.md). Look at
`content/chapters/01-computer/mission-002.json` as the reference example.

When authoring:

- **The objective states what, never how.** If the briefing contains the command, the mission is
  broken.
- **Hints escalate.** Level 1 asks a question. Only the last level gives syntax. Costs rise with
  the level and never fall.
- **`knowledge` is the payload.** It is the step that converts a solved puzzle into
  understanding, and every entry should carry the `realWorld` mapping
  (game concept → security concept → real world).
- **Penalties stay mild.** Failure is a designed step in the learning arc, not a punishment.

## Scope discipline

The spec describes twelve chapters and a multiplayer cyber war. The MVP is **three chapters and
thirty missions**, and the current task is a single vertical slice. Do not build ahead:

| | |
| --- | --- |
| **Build now** | authentication · mission engine · terminal · sandbox · flag validation · XP · progression |
| **Later (P1)** | hints · notebook · skill tree · achievements · analytics |
| **Later (P2)** | AI mentor · story systems · leaderboard · daily challenge |
| **Not yet (P3)** | multiplayer · red team · blue team · cyber war |

Also explicitly out of scope: real money, NFT, blockchain, mobile app, marketplace, social
network, AI-generated missions, Kubernetes.

Do not over-engineer, and prefer simple architecture over infrastructure the product does not
need yet.

## UI direction

Dark, minimal, professional. Black/dark gray with green, blue, amber and red accents. Inter for
UI, JetBrains Mono for terminal and code. Avoid excessive neon, skull iconography, Matrix
pastiche and heavy animation.
