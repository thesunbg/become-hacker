# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

**ZERO → ROOT** — a story-driven web game that teaches cybersecurity by making players
investigate rather than read. Real terminal, isolated sandboxes, no answers handed over.

The full specification lives in [`docs/`](docs/README.md); start at `docs/README.md`. Two
documents constrain everything else:

- **[`docs/06-security.md`](docs/06-security.md)** — sandbox and isolation rules. Non-negotiable.
- **[`docs/07-roadmap.md`](docs/07-roadmap.md)** — what to build now, and what not to build yet.

For shipping it, see [`docs/09-deployment.md`](docs/09-deployment.md). Two constraints there are
easy to trip over: the API serves the web client so the whole game is **one origin** (the
`SameSite=Strict` cookie cannot cross platform hostnames, which are public suffixes), and
`apps/lab-manager` **cannot run on a managed platform** because it needs a Docker daemon.

## Current state

**Vertical Slice #1 is built and playable.** Register → sign in → dashboard → mission 01 → lab →
terminal → find the hidden file → submit the flag → mission complete → XP, all working end to
end, plus mission 02 and the hint system.

```
apps/api            NestJS + Prisma + Postgres + Redis — auth, missions, labs, terminal, XP
apps/web            React + Vite + Tailwind + xterm.js
apps/lab-manager    container lifecycle; the only thing that touches the Docker socket
packages/types      contracts, with the no-flags-to-the-client rule as a compile error
packages/mission-engine  pure objective/score engine
packages/shared     the level curve, shared so client and server cannot disagree
```

354 tests. The API's are integration tests against real Postgres and Redis.

Not built yet: `apps/admin`, the notebook, achievements, chapters 2–3 and their labs. Mission
content stops at 002 of the planned 30.

## Commands

```bash
pnpm install
pnpm infra:up            # postgres + redis via docker compose
pnpm --filter @zero-root/api db:migrate   # apply migrations
pnpm dev                 # turbo run dev across apps

pnpm build
pnpm test
pnpm typecheck
pnpm format              # prettier; format:check runs in CI
pnpm content:validate    # validate mission JSON — dependency-free, works in a bare checkout
```

`pnpm content:validate` is the one check that runs without `pnpm install`. Run it after touching
anything under `content/`.

### Running the game

Four processes: Postgres, Redis, `apps/api` and `apps/web`. `apps/lab-manager` needs a Docker
daemon; without one it refuses to start labs rather than running anything outside a container,
so the terminal will report the lab service as unavailable.

The API's tests need a database. They read `TEST_DATABASE_URL` (default
`postgresql://zeroroot:zeroroot@localhost:5432/zeroroot_test`) and a dedicated Redis database,
and `test/global-setup.ts` migrates it before the suite runs.

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

## Things that are easy to get wrong here, learned the hard way

- **Rebuild packages before running an app against them.** `apps/api` resolves
  `@zero-root/mission-engine` from `dist/`, so an engine change that is not rebuilt is not
  running. `pnpm test` builds dependencies first; invoking `vitest` directly does not.
- **The dual-built packages need their module-type markers.** They declare `"type": "module"`,
  which Node applies to the CommonJS output too, so each build writes a nested `package.json`
  via `scripts/mark-module-type.mjs`. Without it `require()` fails at runtime while type
  checking and the tests still pass.
- **Vitest needs SWC for anything with Nest decorators.** esbuild strips types without emitting
  decorator metadata, and every injected dependency arrives `undefined`.
- **Load order matters at startup.** `ContentService` loads content in its constructor rather
  than `onModuleInit`, because the mission registry's hook ran first and synced nothing.

## Scope discipline

The spec describes twelve chapters and a multiplayer cyber war. The MVP is **three chapters and
thirty missions**, and the current task is a single vertical slice. Do not build ahead:

|                  |                                                                                           |
| ---------------- | ----------------------------------------------------------------------------------------- |
| **Build now**    | authentication · mission engine · terminal · sandbox · flag validation · XP · progression |
| **Later (P1)**   | hints · notebook · skill tree · achievements · analytics                                  |
| **Later (P2)**   | AI mentor · story systems · leaderboard · daily challenge                                 |
| **Not yet (P3)** | multiplayer · red team · blue team · cyber war                                            |

Also explicitly out of scope: real money, NFT, blockchain, mobile app, marketplace, social
network, AI-generated missions, Kubernetes.

Do not over-engineer, and prefer simple architecture over infrastructure the product does not
need yet.

## UI direction

Dark, minimal, professional. Black/dark gray with green, blue, amber and red accents. Inter for
UI, JetBrains Mono for terminal and code. Avoid excessive neon, skull iconography, Matrix
pastiche and heavy animation.
