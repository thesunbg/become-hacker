# ZERO → ROOT

**Learn. Hack. Think. Defend.**

A story-driven web game where the player starts from nothing and becomes a cybersecurity
professional. Real terminal, isolated sandboxes, no hand-holding.

> **Players do not learn first and then play. They play, and that forces them to learn.**

```
Observe → Think → Experiment → Fail → Investigate → Solve → Understand → Apply
```

The player is never handed the answer.

---

## Status

**Pre-MVP.** The repository currently holds the specification, the monorepo scaffolding, the
mission content format with the first two missions authored as data, and the `linux-basic` lab
image. Application code for [Vertical Slice #1](docs/07-roadmap.md) is the next step.

## Documentation

Start at [`docs/README.md`](docs/README.md). The two documents that constrain everything else:

- [`docs/06-security.md`](docs/06-security.md) — the sandbox and isolation rules. **Non-negotiable.**
- [`docs/07-roadmap.md`](docs/07-roadmap.md) — build Vertical Slice #1 and nothing else, first.

## Getting started

Requires Node.js 22+, pnpm, Docker and Docker Compose.

```bash
cp .env.example .env.local        # then fill in SESSION_SECRET
pnpm install
pnpm infra:up                     # postgres + redis
pnpm content:validate             # check mission JSON (no install needed)
pnpm dev
```

## Layout

```
apps/web            React player client
apps/api            NestJS game API
apps/admin          Admin panel
apps/lab-manager    Creates/destroys sandboxes — the only thing that talks to the runtime
packages/           shared · mission-engine · ui · types
content/            Mission JSON + schema (missions are data, never code)
labs/               Sandbox image definitions
infrastructure/     docker · terraform
docs/               Specification
```

## Adding a mission

Missions are **data**. Adding one means adding a file, not changing application code:

```bash
$EDITOR content/chapters/01-computer/mission-003.json
pnpm content:validate
```

The schema is [`content/mission.schema.json`](content/mission.schema.json); the format is
explained in [`docs/04-mission-format.md`](docs/04-mission-format.md).

## Safety

Every exercise in this game runs against environments that are **intentionally vulnerable,
isolated and game-owned**. Players never attack real websites, real addresses, real companies or
real services, and the game provides no capability to do so. Labs run on an internal network
with no route to the internet, to the host, or to production.

## The rule that outranks the rest

> Do not optimize for *how much cybersecurity content can we put into the game*.
> Optimize for *how deeply can the player understand one concept by interacting with it*.
