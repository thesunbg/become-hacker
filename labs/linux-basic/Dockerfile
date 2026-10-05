# ZERO -> ROOT — lab image: linux-basic
#
# A small Linux box for Chapter 1. The player gets an unprivileged shell and has to work out
# where they are, who they are, and what has been left behind for them.
#
# Security posture (docs/06-security.md):
#   - runs as an unprivileged user, never root
#   - no network tooling, because this lab has no network
#   - the container is started with --network isolated, --cap-drop ALL, --read-only,
#     --pids-limit, --cpus and --memory by the lab manager; this Dockerfile does not
#     and cannot grant itself more than that
FROM debian:12-slim

# Only what the Chapter 1 missions actually teach. A lab is not a workstation:
# every extra binary is attack surface and a spoiler.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        procps \
        less \
        findutils \
        grep \
        coreutils \
    && rm -rf /var/lib/apt/lists/*

# The player is an ordinary user. Discovering what that means is mission 03 and 08.
RUN useradd --create-home --shell /bin/bash --uid 1000 player

COPY --chown=player:player rootfs/home/player/ /home/player/
COPY rootfs/opt/zeroroot/ /opt/zeroroot/

# Mission 02: the directory a default listing will not show.
RUN chmod 0700 /home/player/.null \
    && chmod 0600 /home/player/.null/first_contact

USER player
WORKDIR /home/player
ENV HOME=/home/player \
    TERM=xterm-256color

CMD ["/bin/bash", "--login"]
