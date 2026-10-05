# infrastructure/terraform

Production infrastructure, when there is production infrastructure.

Two constraints from [`docs/06-security.md`](../../docs/06-security.md) that belong in the very
first resource definition:

- production and the lab network are **separate networks with no route between them**;
- **no Kubernetes until it is actually necessary** (`docs/05-architecture.md`).

**Empty on purpose.** Development runs on Docker Compose.
