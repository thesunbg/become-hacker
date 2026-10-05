# 06 — Security Model

**This document is non-negotiable.** Everything else in the spec is a preference; this is a
constraint. A feature that violates anything here does not ship.

## Mandatory rules

```
NO production shell
NO Docker socket exposed publicly
NO privileged containers
NO host filesystem mount
NO unrestricted outbound network
NO access to internal network
NO real target scanning
```

Concretely: the API must **never** do anything resembling `exec(command)` on the host. Player
commands only ever run inside a disposable, isolated sandbox.

```
Browser → Game API → Lab Manager → Container → Sandbox
```

## Sandbox requirements

Every lab container must have:

- no access to the production network
- no privileged mode
- a restricted filesystem
- restricted capabilities (drop everything not needed)
- CPU, memory and process limits
- network isolation
- a session timeout

## Lab network topology

```
                    INTERNET
                       ✗  (blocked)
                       │
              ┌────────▼────────┐
              │   LAB NETWORK   │
              └────────┬────────┘
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
   Player VM       Target VM       Service
        └──────────────┼──────────────┘
                       ▼
                  FLAG SERVER
```

**Production infrastructure must never be part of the lab network.**

```
Production:            Labs:
Internet               LAB CONTROL PLANE
  │ CDN/WAF                  │
  │ Frontend          ┌──────┴──────┐
  │ API              LAB A        LAB B
  │ Database        isolated     isolated
```

Production and labs are strongly separated. They are different networks with no route between
them.

## Resource limits

Every lab gets a hard ceiling on CPU, RAM, disk, processes, network and time. Starting values
(tune after load testing):

```
CPU:     0.5–2 cores
RAM:     256 MB – 1 GB
Disk:    1 GB
Session: 30–60 minutes
```

These are configured in `.env.example` as `LAB_*`.

## Anti-cheat — never trust the client

The server validates **mission completion, flags, XP, achievements and lab state**. All of them.

This must be impossible:

```
POST /mission/complete   { "score": 1000 }
```

Scoring is derived server-side from the recorded event stream (see
[04-mission-format.md](04-mission-format.md)). Flags live in `mission_flags` and are never sent
to the client — not in a mission payload, not in a debug field, not in a source map.

## Authentication

MVP: email + password. Later: Google, GitHub, passkey.

Required: Argon2 (or bcrypt) password hashing · secure cookies · CSRF protection where
applicable · rate limiting · login attempt protection · audit logs.

## Content safety

All exercises target environments that are **intentionally vulnerable, isolated, game-owned and
sandboxed**.

Never require — or enable — players to attack:

```
real websites · real IP addresses · real companies · real services
```

The Chapter 3 web labs are deliberately vulnerable applications on game-owned fake domains
(`bank.local`, `shop.local`, `forum.local`, `admin.local`), each isolated. Their vulnerabilities
(weak authentication, insecure authorization, IDOR, reflected XSS, SQL injection, insecure file
handling) are **intentional and sandboxed**, and exist only to be understood and then defended.

## Security testing

Part of CI, not an afterthought. Test for:

```
container escape · network escape · filesystem access · resource exhaustion
command injection · WebSocket abuse · API authorization · rate limiting
```

## Documenting assumptions

Every dangerous operation must be sandboxed, and **every security assumption must be written
down** next to the code that relies on it.
