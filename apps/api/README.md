# apps/api — game API

NestJS · TypeScript · Prisma · PostgreSQL · Redis.

Modules: `auth · users · missions · chapters · skills · progress · xp · achievements · labs ·
terminal · hints · notebook · leaderboard · notifications`.

The API surface and database model are in [`docs/05-architecture.md`](../../docs/05-architecture.md).

**Not yet implemented** — Sprint 1 of [`docs/07-roadmap.md`](../../docs/07-roadmap.md).

Two rules this app exists to enforce: all progress is validated server-side from the recorded
event stream, and **player commands never execute in this process** — they are forwarded to the
lab manager.
