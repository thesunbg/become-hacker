# 09 — Deployment

## The shape of the problem

The game is three services, and they do not have the same hosting needs:

| Service                 | Needs                                             | Runs on a PaaS? |
| ----------------------- | ------------------------------------------------- | --------------- |
| `apps/api` + `apps/web` | A long-lived Node process, Postgres, Redis        | **Yes**         |
| `apps/lab-manager`      | A **Docker daemon**, to create sandbox containers | **No**          |

Managed platforms — Railway, Render, Fly, Vercel — run your code _inside_ a container and do
not hand you the host's Docker socket. `apps/lab-manager` therefore cannot run on one, and it
refuses rather than falling back to running player commands anywhere else
([`06-security.md`](06-security.md)). Without it there are no labs, so there is no terminal and
no mission: a PaaS-only deployment gets you a sign-in page and nothing to do.

## One origin, not two

**The web client is served by the API process**, from `WEB_ROOT`. This is a requirement, not a
packaging preference.

The session cookie is `SameSite=Strict`, so a browser carries it only within one site. Platform
hostnames like `*.up.railway.app` are on the [Public Suffix List](https://publicsuffix.org/),
which means `web-abc.up.railway.app` and `api-xyz.up.railway.app` are two **different sites** —
the browser drops the cookie between them and every authenticated request returns 401. Splitting
the front end from the API on generated platform hostnames cannot be made to work without either
a custom domain (`game.example.com` + `api.game.example.com`, which _are_ the same site) or
weakening the cookie to `SameSite=None`, which gives up a layer of CSRF defence and is blocked
by Safari's third-party cookie rules anyway.

Serving both from one process also removes CORS preflights and makes the CSRF origin check
trivially correct.

## Deploying the game service

The root [`Dockerfile`](../Dockerfile) builds the shared packages, then the web client, then the
API, and starts by applying migrations. [`railway.json`](../railway.json) points Railway at it.

### Railway

Create **one** service from the repository, plus the Postgres and Redis plugins. Three separate
services for web, api and lab-manager will not work — see above.

| Variable         | Value                                   |
| ---------------- | --------------------------------------- |
| `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}`            |
| `REDIS_URL`      | `${{Redis.REDIS_URL}}`                  |
| `SESSION_SECRET` | 32+ characters — `openssl rand -hex 32` |
| `NODE_ENV`       | `production`                            |

`PORT`, `CONTENT_DIR` and `WEB_ROOT` are handled for you: the platform injects the first, and
the image sets the other two. `WEB_ORIGIN` defaults to `https://$RAILWAY_PUBLIC_DOMAIN`, so set
it explicitly only when using a custom domain.

The API refuses to start if `SESSION_SECRET` is shorter than 32 characters in production. That
is deliberate — a deployment running on a known default secret is worse than one that will not
start.

### Any other container host

```bash
docker build -t zeroroot/game .
docker run -p 8080:3001 \
  -e NODE_ENV=production \
  -e DATABASE_URL=postgresql://... \
  -e REDIS_URL=redis://... \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  -e WEB_ORIGIN=https://your-domain \
  zeroroot/game
```

## Deploying the lab manager

This needs a machine you control: a VPS with Docker installed.

```bash
# On the VPS, from a checkout of this repository:
docker build -f apps/lab-manager/Dockerfile -t zeroroot/lab-manager .
docker build -t zeroroot/linux-basic:latest labs/linux-basic
docker network create --internal zeroroot-lab

docker run -d --name zeroroot-lab-manager \
  -e NODE_ENV=production \
  -e LAB_MANAGER_TOKEN="$TOKEN" \
  -e LAB_MANAGER_HOST=0.0.0.0 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -p 127.0.0.1:3002:3002 \
  zeroroot/lab-manager
```

Then point the game service at it with `LAB_MANAGER_URL` and the same `LAB_MANAGER_TOKEN`.

Three things about that command are load-bearing:

- **The lab network is `--internal`.** No gateway, so a lab container has no route to the
  internet, to the host, or to your database.
- **The port is bound to loopback.** The lab manager is not meant to be reachable from the
  internet. Expose it to the game service over a private network or a tunnel, never publicly.
- **The Docker socket is mounted**, which gives that container control of the host's containers.
  Nothing else should share the machine with it, and it should not be the machine your database
  lives on. The sandboxes it creates hold none of this power — see
  [`apps/lab-manager/src/sandbox-spec.ts`](../apps/lab-manager/src/sandbox-spec.ts).

Each lab is allowed up to 1 CPU and 512 MB, so size the VPS by how many players you expect at
once, not by how many accounts exist.

## The simplest arrangement

One VPS with Docker running everything through `docker compose`, with Postgres and Redis as
containers. No cookie problems, no split networking, no platform that cannot run your sandboxes.
Reach for a PaaS when you want the game service managed, and keep a VPS for the labs.

## What is not here yet

Production Terraform ([`infrastructure/terraform/`](../infrastructure/terraform) is empty on
purpose), a CDN or WAF in front of the API, and the stronger production/lab network separation
that [`06-security.md`](06-security.md) calls for — currently the lab network is isolated by
construction, but the lab manager still shares a host with whatever else you put on it.
