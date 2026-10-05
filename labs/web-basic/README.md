# Lab: web-basic — *not yet built*

Chapter 3's sandbox. Planned contents (see [`docs/07-roadmap.md`](../../docs/07-roadmap.md),
Sprint 6):

```
Browser · web server · database · authentication
```

Deliberately vulnerable applications on game-owned fake domains, each isolated:

```
bank.local · shop.local · forum.local · admin.local
```

Intended vulnerability classes: weak authentication, insecure authorization, IDOR, reflected
XSS, SQL injection, insecure file handling.

Every one of those is **intentional, isolated and game-owned**. The player never points a tool
at anything real — see [`docs/06-security.md`](../../docs/06-security.md).

**Do not build this before Chapters 1 and 2 are playable.**
