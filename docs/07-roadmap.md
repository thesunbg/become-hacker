# 07 — Roadmap & Definition of Done

## First technical milestone — Vertical Slice #1

Build **only** this. Nothing else.

```
Register → Login → Dashboard → Mission 01 → Start Lab → Terminal
         → whoami → pwd → ls -la → find hidden file → submit flag
         → server validates → mission completed → +100 XP
```

Through the full stack:

```
React frontend → NestJS API → PostgreSQL → Redis → Docker sandbox
```

> Do not implement Chapter 2 or 3. Do not implement AI. Do not implement multiplayer. Do not
> implement the leaderboard.
>
> **The first objective is to make the first 10 minutes genuinely playable.**

## Sprints

| Sprint | Goal | Tasks |
| --- | --- | --- |
| **1** | Working vertical slice skeleton | monorepo · React · NestJS · PostgreSQL · Redis · Docker Compose · authentication · user profile · dashboard · mission model · mission API · mission page · lab session model · terminal UI |
| **2** | First playable mission | Linux sandbox · terminal backend · WebSocket · command execution · mission objective engine · flag validation · XP · mission completion · hint system |
| **3** | Chapter 1, part 1 | missions 01–05, then **test with real beginners** |
| **4** | Chapter 1 complete | missions 06–10 |
| **5** | Chapter 2 starts | network sandbox: Linux client, Linux server, DNS, HTTP, multiple ports |
| **6** | Chapter 3 starts | web sandbox: browser, web server, database, authentication |

## MVP definition of done

```
✓ User can register              ✓ Player can submit flag
✓ User can login                 ✓ Server validates flag
✓ User can see progression       ✓ XP is awarded
✓ User can start a mission       ✓ Hints work
✓ User gets isolated lab         ✓ Notebook works
✓ User gets terminal             ✓ Mission history works
✓ Commands execute safely        ✓ 30 missions playable
✓ Mission engine detects         ✓ Chapter progression works
  objectives                     ✓ No production network access
```

## Priorities

| | Features |
| --- | --- |
| **P0** | authentication · mission engine · terminal · sandbox · flag validation · XP · progression |
| **P1** | hints · notebook · skill tree · achievements · analytics |
| **P2** | AI mentor · story · leaderboard · daily challenge |
| **P3** | multiplayer · red team · blue team · cyber war |

## Testing

**Unit** — mission engine · XP calculation · hint calculation · flag validation · progression ·
skill calculation.

**Integration** — create lab · execute command · destroy lab · complete mission.

**Security** — see [06-security.md](06-security.md).

**Load** — 10 / 50 / 100 concurrent labs. Measure lab startup time, terminal latency, CPU, RAM,
network, database, Redis.

## Performance targets

Initial targets, to be tuned against real measurement:

```
Dashboard load   < 2 s
Mission load     < 1 s
Lab startup      < 10 s
Terminal latency < 200 ms
API p95          < 300 ms
```

## Development environment

Required: Node.js · pnpm · Docker · Docker Compose · PostgreSQL · Redis · Git.

## Coding rules

1. Do not over-engineer.
2. Implement one vertical slice first.
3. Do not build future features before the MVP works.
4. Keep mission content data-driven.
5. Keep lab execution isolated.
6. Never expose production infrastructure.
7. Never trust client-side score/progress.
8. Write tests for the mission engine.
9. Use TypeScript strict mode.
10. Keep modules independent.
11. Use clean API contracts.
12. Document security assumptions.
13. Every dangerous operation must be sandboxed.
14. Prefer simple architecture over premature Kubernetes.
15. Every feature must have a clear user-facing purpose.
