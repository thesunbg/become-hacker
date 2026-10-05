# ZERO -> ROOT — the game service: API + web client on one origin.
#
# One image, one process, one origin. That last part is a requirement rather than a
# simplification: the session cookie is SameSite=Strict, and platform hostnames such as
# *.up.railway.app are public suffixes, so two services deployed there are two *sites* and the
# browser will not carry the cookie between them. Serving the SPA from the API sidesteps that,
# along with CORS and any chance of the CSRF origin check disagreeing with reality.
#
# This image does NOT include apps/lab-manager. That service needs a Docker daemon to create
# sandbox containers, which a managed container platform does not provide — see
# apps/lab-manager/Dockerfile and docs/09-deployment.md.

# ---------------------------------------------------------------------------- build
FROM node:22-slim AS builder

# Prisma needs OpenSSL to pick its query engine.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

# The whole workspace is copied before installing: pnpm needs every package.json to resolve
# the workspace graph, and splitting that into a separate layer saves little here.
COPY . .

RUN pnpm install --frozen-lockfile

# Order matters. apps/* resolve the shared packages from their dist/ output, so a build that
# skips this step compiles against nothing and fails.
RUN pnpm --filter @zero-root/types \
         --filter @zero-root/shared \
         --filter @zero-root/mission-engine \
         build

RUN pnpm --filter @zero-root/web build
RUN pnpm --filter @zero-root/api build

# ---------------------------------------------------------------------------- runtime
FROM node:22-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

ENV NODE_ENV=production
# Absolute, because the defaults are relative to the working directory and would resolve
# outside the image.
ENV CONTENT_DIR=/app/content
ENV WEB_ROOT=/app/apps/web/dist

# node_modules comes across whole. pnpm's store is a symlink farm, so pruning it after the
# fact tends to break the links; the Prisma CLI is also needed at start to run migrations.
COPY --from=builder /app /app

# The API never needs to write to its own image.
RUN useradd --create-home --uid 10001 zeroroot \
    && chown -R zeroroot:zeroroot /app
USER zeroroot

WORKDIR /app/apps/api
EXPOSE 3001

# Migrations run before the server accepts traffic. `migrate deploy` applies committed
# migrations only — it never generates one, and never resets a database.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && node dist/main.js"]
