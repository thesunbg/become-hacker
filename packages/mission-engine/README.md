# packages/mission-engine

The heart of the game, and deliberately the most boring package to depend on.

```
(mission definition, event stream, player state) → (progress, score, rewards)
```

Pure and framework-free: no I/O, no Nest decorators, no database, no clock it does not receive
as input. That is what lets it be exhaustively unit-tested, and **unit tests here are
required** — see [`docs/07-roadmap.md`](../../docs/07-roadmap.md).

Responsibilities: load mission · create session · track objectives · validate actions ·
calculate score · unlock hints · complete mission · award XP.

If a new mission would need application changes, the missing capability belongs here — not in a
component and not in an API module.

**Not yet implemented** — Sprint 2.
