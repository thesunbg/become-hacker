# Labs

Each directory here is a **sandbox image** that a mission's `environment.image` can name.

A lab is disposable. It is created when the player enters, it collects events while they play,
and it is destroyed when they leave. Nothing in a lab is durable, and nothing in a lab may reach
anything real.

## Non-negotiable constraints

Every lab container runs with, at minimum:

```
--network zeroroot-lab   isolated network, no route to the internet or to production
--cap-drop ALL           no capabilities beyond what the mission needs
--security-opt no-new-privileges
--read-only              plus explicit tmpfs for the paths the mission writes
--pids-limit             bounded process count
--cpus / --memory        bounded CPU and RAM
                         plus a session timeout enforced by the lab manager
```

Never `--privileged`. Never a host bind mount. Never the Docker socket.

See [`docs/06-security.md`](../docs/06-security.md) — that document outranks convenience.

## Images

| Image           | Chapter | Contains                                                            |
| --------------- | ------- | ------------------------------------------------------------------- |
| `linux-basic`   | 1       | A single Linux box: filesystem, users, permissions, processes, logs |
| `network-basic` | 2       | Linux client + server, DNS, HTTP, several listening ports           |
| `web-basic`     | 3       | Deliberately vulnerable web apps on game-owned fake domains         |

## The flag rule

A mission's flag is planted in the lab at build or start time and validated **server-side**. The
flag value is never sent to the browser.
