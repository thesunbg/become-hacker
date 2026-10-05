# ZERO -> ROOT — lab manager.
#
# This service creates and destroys the sandbox containers players work in, so it needs a
# Docker daemon. That rules out managed container platforms: Railway, Render, Fly and Vercel
# all run your code *inside* a container and do not hand you the host's Docker socket.
#
# It belongs on a machine you control. See docs/09-deployment.md.
#
# Run it with the socket mounted and nothing else:
#   docker run -d --name zeroroot-lab-manager \
#     -e NODE_ENV=production -e LAB_MANAGER_TOKEN="$TOKEN" \
#     -e LAB_MANAGER_HOST=0.0.0.0 \
#     -v /var/run/docker.sock:/var/run/docker.sock \
#     -p 127.0.0.1:3002:3002 \
#     zeroroot/lab-manager
#
# Mounting the Docker socket gives this container control of the host's containers, which is
# why nothing else shares this machine with it, why it binds loopback by default, and why the
# API reaches it over a private network with a shared token.

FROM node:22-slim AS builder

RUN corepack enable
WORKDIR /app
COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @zero-root/types build
RUN pnpm --filter @zero-root/lab-manager build

FROM node:22-slim AS runtime

RUN corepack enable
WORKDIR /app
ENV NODE_ENV=production
# The lab image definitions, which the manager reads to validate what may be started.
ENV LABS_DIR=/app/labs

COPY --from=builder /app /app

WORKDIR /app/apps/lab-manager
EXPOSE 3002

# Runs as root deliberately and only here: talking to the mounted Docker socket requires it.
# The sandboxes this process creates never do — see src/sandbox-spec.ts.
CMD ["node", "dist/main.js"]
