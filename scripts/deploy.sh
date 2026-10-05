#!/usr/bin/env bash
#
# ZERO -> ROOT — deploy the whole stack onto this machine.
#
#   ./scripts/deploy.sh play.example.com      # with a domain: HTTPS via Caddy on 80/443
#   ./scripts/deploy.sh --no-domain           # by IP, HTTP on port 8080
#   ./scripts/deploy.sh --no-domain 9000      # by IP, HTTP on a port you choose
#
# Idempotent. Secrets in .env are generated once and never regenerated; re-running with
# different arguments updates only the keys that describe how the site is reached.
set -euo pipefail

cd "$(dirname "$0")/.."

RED=$'\033[0;31m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[0;33m'; DIM=$'\033[2m'; OFF=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✓%s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%s!%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%s✗ %s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

usage() {
  say "Usage:"
  say "  $0 <domain>              HTTPS via Caddy (needs ports 80 and 443)"
  say "  $0 --no-domain [port]    HTTP on <port>, default 8080"
  exit 1
}

COMPOSE_FILE=docker-compose.prod.yml
MODE_ARG="${1:-}"
PORT_ARG="${2:-}"
[ -n "$MODE_ARG" ] || usage

port_in_use() {
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${1}\$"
}

# Writes KEY=VALUE into .env, replacing an existing line or appending one.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    # The value can contain slashes (URLs), so use a delimiter that cannot appear in a key.
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

# ---------------------------------------------------------------- preflight
say "${DIM}Checking this machine…${OFF}"

command -v docker >/dev/null 2>&1 || die "Docker is not installed. See https://docs.docker.com/engine/install/"
docker info >/dev/null 2>&1 || die "Cannot talk to the Docker daemon. Is it running, and are you root or in the docker group?"

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  die "Docker Compose is not installed. See https://docs.docker.com/compose/install/"
fi
ok "Docker and Compose are available"

# The web client's bundler is the memory-hungry step. Under about 2 GB of RAM plus swap it
# gets killed mid-build, and the error that surfaces ("exit code 137") says nothing useful.
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
swap_kb=$(awk '/SwapTotal/ {print $2}' /proc/meminfo)
total_mb=$(( (mem_kb + swap_kb) / 1024 ))
if [ "$total_mb" -lt 1900 ]; then
  warn "Only ${total_mb} MB of RAM + swap. The web build needs roughly 2 GB and will be"
  warn "  killed without it (you would see 'exit code 137'). Add swap first:"
  say  "    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile"
  say  "    echo '/swapfile none swap sw 0 0' >> /etc/fstab"
  die  "Not enough memory to build."
fi
ok "Memory: ${total_mb} MB available for the build"

avail_mb=$(df -Pm . | awk 'NR==2 {print $4}')
[ "$avail_mb" -ge 6000 ] || warn "Only ${avail_mb} MB of disk free; the images need roughly 5 GB."

# ------------------------------------------------------------------- mode
if [ "$MODE_ARG" = "--no-domain" ]; then
  USE_HTTPS=0
  GAME_BIND=0.0.0.0
  # Defaults to 8080 rather than 80: a VPS usually has something on 80 already, and
  # discovering that from a failed container start is a bad way to find out.
  GAME_PORT="${PORT_ARG:-8080}"

  case "$GAME_PORT" in
    ''|*[!0-9]*) die "Port must be a number: $0 --no-domain 9000" ;;
  esac
  port_in_use "$GAME_PORT" && die "Port ${GAME_PORT} is already in use. Pick another: $0 --no-domain 9000"
  ok "Port ${GAME_PORT} is free"

  # The CSRF check compares the browser's Origin header against WEB_ORIGIN exactly, and the
  # browser includes a non-default port. Getting this wrong means every sign-in returns 403.
  PUBLIC_IP="${PUBLIC_IP:-$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)}"
  [ -n "$PUBLIC_IP" ] || PUBLIC_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
  [ -n "$PUBLIC_IP" ] || die "Could not work out this server's address. Re-run with PUBLIC_IP=1.2.3.4 $0 --no-domain"

  PUBLIC_URL="http://${PUBLIC_IP}:${GAME_PORT}"
  ok "Serving on ${PUBLIC_URL}"

  warn "Running without a domain, which means without TLS."
  warn "  The session cookie will travel in clear text: anyone on the network path can read"
  warn "  it and sign in as that player. Use this to check the deployment works, then point"
  warn "  a domain here and re-run with it."
else
  [ -z "$PORT_ARG" ] || usage
  USE_HTTPS=1
  DOMAIN="$MODE_ARG"
  GAME_BIND=127.0.0.1
  GAME_PORT=8080
  PUBLIC_URL="https://${DOMAIN}"

  # Caddy asks Let's Encrypt for a certificate on first run, and that fails unless the name
  # already resolves here. Better to say so now than to read it out of a crash loop.
  resolved=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  mine=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
  if [ -n "$resolved" ] && [ -n "$mine" ] && [ "$resolved" != "$mine" ]; then
    warn "${DOMAIN} resolves to ${resolved}, but this server appears to be ${mine}."
    warn "  Caddy will not get a certificate until DNS points here."
  elif [ -z "$resolved" ]; then
    warn "${DOMAIN} does not resolve yet. Caddy needs it to, before it can get a certificate."
  else
    ok "${DOMAIN} resolves to this server"
  fi

  for port in 80 443; do
    if port_in_use "$port"; then
      die "Port ${port} is already in use, and Caddy needs both 80 and 443.
  Either free it, or deploy without a domain on a different port:
      $0 --no-domain 8080"
    fi
  done
  ok "Ports 80 and 443 are free"
fi

# -------------------------------------------------------------------- .env
if [ -f .env ]; then
  ok ".env exists — keeping its secrets, updating how the site is reached"
else
  say "${DIM}Generating .env with fresh secrets…${OFF}"
  command -v openssl >/dev/null 2>&1 || die "openssl is needed to generate secrets."
  {
    echo "# Generated by scripts/deploy.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "LAB_MANAGER_TOKEN=$(openssl rand -hex 24)"
    echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"
  } > .env
  ok "Wrote .env with generated secrets"
fi

set_env WEB_ORIGIN "$PUBLIC_URL"
set_env GAME_BIND "$GAME_BIND"
set_env GAME_PORT "$GAME_PORT"
if [ "$USE_HTTPS" = "1" ]; then
  set_env DOMAIN "$DOMAIN"
  set_env SESSION_COOKIE_SECURE "true"
else
  set_env SESSION_COOKIE_SECURE "false"
fi
chmod 600 .env

# ------------------------------------------------------------------ deploy
PROFILES=()
[ "$USE_HTTPS" = "1" ] && PROFILES=(--profile https)

say ""
say "${DIM}Building. The first run takes a few minutes.${OFF}"
"${COMPOSE[@]}" -f "$COMPOSE_FILE" "${PROFILES[@]}" build

say ""
say "${DIM}Starting…${OFF}"
"${COMPOSE[@]}" -f "$COMPOSE_FILE" "${PROFILES[@]}" up -d

# ------------------------------------------------------------------ verify
say ""
say "${DIM}Waiting for the game to answer…${OFF}"
for attempt in $(seq 1 60); do
  # 401 from /api/me without a session is the expected answer: it means the app is serving.
  code=$(curl -fsS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${GAME_PORT}/api/me" 2>/dev/null || true)
  if [ "$code" = "401" ]; then
    ok "The API is up"
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    warn "The game did not answer in 60s. Last 40 lines:"
    "${COMPOSE[@]}" -f "$COMPOSE_FILE" logs --tail 40 game
    die "Deployment did not come up cleanly."
  fi
  sleep 1
done

say ""
ok "Deployed. Open ${PUBLIC_URL}"
say ""
say "${DIM}  logs:    ${COMPOSE[*]} -f ${COMPOSE_FILE} logs -f game${OFF}"
say "${DIM}  stop:    ${COMPOSE[*]} -f ${COMPOSE_FILE} down${OFF}"
say "${DIM}  update:  git pull && $0 ${MODE_ARG} ${PORT_ARG}${OFF}"
