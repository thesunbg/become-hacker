# ZERO → ROOT — Documentation

The product specification, split into the documents an implementer actually needs.

| Document | What it answers |
| --- | --- |
| [01-vision.md](01-vision.md) | What the game is, who it is for, what we are deliberately *not* building. |
| [02-gameplay.md](02-gameplay.md) | Game loop, progression, XP, hints, skills, ratings, achievements, story. |
| [03-curriculum.md](03-curriculum.md) | The 30 MVP missions across Chapters 1–3, plus the post-MVP chapter roadmap. |
| [04-mission-format.md](04-mission-format.md) | Mission JSON schema, objective types, state machine, the mission engine contract. |
| [05-architecture.md](05-architecture.md) | Monorepo layout, stack, backend modules, API surface, database model, events. |
| [06-security.md](06-security.md) | Sandbox model, lab isolation, resource limits, anti-cheat, content safety. **Non-negotiable.** |
| [07-roadmap.md](07-roadmap.md) | Sprint plan, MVP definition of done, priorities, testing and performance targets. |
| [08-metrics.md](08-metrics.md) | Analytics, learning analytics, product metrics, observability. |

## The one rule that outranks the rest

> Do not optimize for *how much cybersecurity content can we put into the game*.
> Optimize for *how deeply can the player understand one concept by interacting with it*.

A 10-minute mission that makes a player genuinely understand DNS beats a 30-page DNS lesson.
