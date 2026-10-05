# packages/types

Shared contracts between `apps/web`, `apps/api` and `apps/lab-manager`: mission definitions,
event types, objective types, API DTOs.

One rule: a mission DTO that crosses to the client must not carry `flag`. Model that in the
types so the compiler enforces it rather than a code review.

**Not yet implemented** — Sprint 1.
