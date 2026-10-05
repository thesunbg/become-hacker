# apps/lab-manager — sandbox lifecycle

The only component that talks to the container runtime.

```
POST /labs → validate mission → create isolated environment → return session id
          → connect terminal → collect events → validate completion → destroy environment
```

It owns the limits in `.env.example` (`LAB_CPU_LIMIT`, `LAB_MEMORY_LIMIT`, `LAB_PIDS_LIMIT`,
`LAB_SESSION_TIMEOUT_SECONDS`) and attaches every lab to the internal `zeroroot-lab` network,
which has no route to the internet, the host or production.

**Not yet implemented** — Sprint 2 of [`docs/07-roadmap.md`](../../docs/07-roadmap.md).

Read [`docs/06-security.md`](../../docs/06-security.md) before writing a line of this. The Docker
socket is reachable from here and nowhere else, and that is the whole reason this app is a
separate process.
