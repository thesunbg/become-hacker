# 08 — Metrics & Observability

## Event analytics

Track: `mission_start · mission_complete · mission_fail · hint_used · command_executed ·
flag_submitted · time_spent · abandon`.

Derived mission metrics:

```
Completion rate · Average attempts · Average hints
Average completion time · Drop-off mission · Most difficult mission
```

## Learning analytics

Per player: weakest skill · strongest skill · common mistakes · common hints · average solving
time.

Then act on it. If the player is strong in Linux but weak in networking:

```
Recommended:
  Network Mission #14
  Network Mission #16
  DNS Challenge
```

## Product metrics

| Metric | Definition |
| --- | --- |
| **Activation** | % of users completing Mission 01 |
| **Engagement** | Missions / user / week |
| **Learning** | Average chapter completion |
| **Difficulty** | Mission failure rate |
| **Retention** | D1 / D7 / D30 |
| **Skill improvement** | Pre/post assessment |

Activation is the one to watch first — it is the direct measurement of whether the first ten
minutes work.

## Observability

Use structured logs, metrics, error tracking and audit logs.

Track: API latency · lab startup time · lab failures · terminal errors · mission failures.
