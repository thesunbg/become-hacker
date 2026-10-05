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

**Vertical Slice #1 is playable.** Register, sign in, open mission 01, get an isolated lab, use
a real terminal, discover the hidden file, submit the flag, and earn XP — with mission 02, the
hint system and the knowledge review working end to end.

354 tests, including integration tests that drive the whole flow against real Postgres and
Redis, and security tests that assert the sandbox's posture without needing a Docker daemon.

Next: the rest of Chapter 1 (missions 003–010), then Chapters 2 and 3. See
[`docs/07-roadmap.md`](docs/07-roadmap.md).

## Documentation

Start at [`docs/README.md`](docs/README.md). The two documents that constrain everything else:

- [`docs/06-security.md`](docs/06-security.md) — the sandbox and isolation rules. **Non-negotiable.**
- [`docs/07-roadmap.md`](docs/07-roadmap.md) — build Vertical Slice #1 and nothing else, first.

## Getting started

Requires Node.js 22+, pnpm, Docker and Docker Compose.

```bash
cp .env.example .env.local                  # then fill in SESSION_SECRET
pnpm install
pnpm infra:up                               # postgres + redis
pnpm --filter @zero-root/api db:migrate     # create the schema
pnpm dev                                    # api on :3001, web on :5173
```

Then open http://localhost:5173 and create an account.

`apps/lab-manager` needs a Docker daemon to start labs. Without one it refuses rather than
running player commands anywhere else, so the terminal will report the lab service as
unavailable — see [Safety](#safety).

```bash
pnpm test              # 354 tests; the API's need Postgres and Redis
pnpm typecheck
pnpm content:validate  # mission JSON; the one check that needs no install
```

## Layout

```
apps/web            React · Vite · Tailwind · xterm.js
apps/api            NestJS · Prisma · PostgreSQL · Redis
apps/lab-manager    Creates/destroys sandboxes — the only thing that talks to the runtime
apps/admin          Admin panel (not built yet)
packages/types      Shared contracts; flags-to-the-client is a compile error
packages/mission-engine  Pure objective and scoring engine
packages/shared     Progression curve, shared so client and server agree
packages/ui         Shared components (not built yet)
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

## Deploying

The API serves the web client, so the game is **one service on one origin** — that is what makes
the `SameSite=Strict` session cookie work, since platform hostnames like `*.up.railway.app` are
public suffixes and would otherwise count as separate sites.

```bash
./scripts/deploy.sh play.example.com   # on a VPS with Docker: builds and starts everything
```

`apps/lab-manager` is deliberately not in that image: it needs a Docker daemon to create
sandboxes, which managed platforms do not provide, so it belongs on a machine you control.
Full instructions, including the Railway variables, are in
[`docs/09-deployment.md`](docs/09-deployment.md).

## Safety

Every exercise in this game runs against environments that are **intentionally vulnerable,
isolated and game-owned**. Players never attack real websites, real addresses, real companies or
real services, and the game provides no capability to do so. Labs run on an internal network
with no route to the internet, to the host, or to production.

## The rule that outranks the rest

> Do not optimize for _how much cybersecurity content can we put into the game_.
> Optimize for _how deeply can the player understand one concept by interacting with it_.
