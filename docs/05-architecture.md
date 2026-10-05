# 05 — Architecture

## Repository layout

```
zero-root/
├── apps/
│   ├── web/            React player client
│   ├── api/            NestJS game API
│   ├── admin/          Admin panel
│   └── lab-manager/    Creates/destroys sandboxes; the ONLY thing that talks to the runtime
├── packages/
│   ├── shared/         Cross-cutting utilities
│   ├── mission-engine/ Pure, framework-free objective/score engine
│   ├── ui/             Shared components
│   └── types/          Shared contracts
├── content/            Mission JSON + assets (data-driven, see 04-mission-format.md)
├── labs/               Sandbox image definitions (linux-basic, network-basic, web-basic)
├── infrastructure/
│   ├── docker/
│   └── terraform/
└── docs/
```

Monorepo tooling: **pnpm workspaces + Turborepo** (`pnpm dev` / `build` / `test` / `lint`).

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | React · TypeScript · Vite · Tailwind CSS |
| Terminal | **xterm.js** |
| State | Zustand |
| Routing | React Router |
| Backend | Node.js · TypeScript · **NestJS** (Fastify is the acceptable alternative) |
| Database | **PostgreSQL** via Prisma |
| Cache/queues | Redis |
| Transport | WebSocket for terminal, lab status, mission events, notifications |

TypeScript **strict mode** everywhere.

## Backend modules

```
auth · users · missions · chapters · skills · progress · xp · achievements
labs · terminal · hints · notebook · leaderboard · notifications
```

Future: `ai · redteam · blueteam · multiplayer`.

Keep modules independent with clean API contracts.

## Frontend routes

```
/ · /login · /register
/dashboard
/missions · /missions/:id
/lab/:sessionId
/skills · /notebook · /achievements · /profile
/admin
```

## UI direction

Dark · minimal · cybersecurity · terminal · modern · professional.

**Avoid:** excessive neon, childish hacker clichés, skulls everywhere, Matrix clones,
over-complicated animations.

Palette: black / dark gray, with green, blue, amber, red as accents.
Typography: **Inter** for UI, **JetBrains Mono** for terminal and code.

Dashboard sketch:

```
┌─────────────────────────────────────────────┐
│ ZERO → ROOT                                 │
├─────────────────────────────────────────────┤
│ Level 7 Hacker                              │
│ ███████████████░░░ 72%                      │
│                                             │
│ 🧠 Thinking 82   💻 Technical 71   🛡 Defense 44 │
│                                             │
│ CURRENT MISSION                             │
│ ┌─────────────────────────────────────────┐ │
│ │ The Forgotten Door                      │ │
│ │ Difficulty ★★★       [ ENTER LAB ]      │ │
│ └─────────────────────────────────────────┘ │
│ SKILL TREE                                  │
└─────────────────────────────────────────────┘
```

## Terminal

The core feature. Requirements: keyboard input · command history · Ctrl+C · clear ·
autocomplete · output streaming · copy · paste · resize.

```
┌──────────────────────────────────────────┐
│ TERMINAL                                 │
├──────────────────────────────────────────┤
│ $ whoami                                 │
│ player                                   │
│ $ pwd                                    │
│ /home/player                             │
│ $ _                                      │
└──────────────────────────────────────────┘
```

Transport chain — **never expose the container runtime to the browser**:

```
Browser → WebSocket → Terminal Gateway → Lab Manager → Sandbox
```

## API surface

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout
GET    /api/me

GET    /api/chapters
GET    /api/missions
GET    /api/missions/:id
POST   /api/missions/:id/start
POST   /api/missions/:id/hint

POST   /api/labs
DELETE /api/labs/:id

GET    /api/me/progress
GET    /api/me/skills
GET    /api/me/achievements

GET    /api/notebook
POST   /api/notebook/notes
PUT    /api/notebook/notes/:id
DELETE /api/notebook/notes/:id
```

## Database

```
users · profiles
chapters · missions · mission_tasks · mission_hints · mission_flags
user_missions · user_tasks
skills · user_skills
achievements · user_achievements
xp_transactions
lab_sessions · lab_events
notebooks · notes
audit_logs
```

### The XP ledger principle

Do **not** store only `user.xp = 1000`. Store an append-only ledger:

```
xp_transactions( id, user_id, amount, reason, mission_id, created_at )
```

and derive the total. This makes cheating detectable and debugging possible.

## Redis usage

sessions · rate limiting · queues · temporary lab state · terminal connections.

## Lab lifecycle

```
POST /labs → validate mission → create isolated environment → return session id
          → connect terminal → player plays → collect events
          → validate completion → destroy environment
```

```
create container → player plays → collect state → destroy container
```

## Infrastructure

Development: **Docker Compose** — `frontend · backend · postgres · redis · lab-manager`.

Production v1: frontend · backend · PostgreSQL · Redis · lab worker · container runtime.

> **Do not introduce Kubernetes until it is actually necessary.**

## Admin panel

`/admin` can create/edit/publish/disable chapters and missions, and view player progress, lab
sessions, errors and mission analytics. A visual mission editor comes later.

## Environments

```
.env.local · .env.test · .env.production
```

**Never commit secrets.** `.env.example` documents the shape.

## CI/CD

```
git push → lint → typecheck → unit tests → integration tests → build → security scan → deploy
```
