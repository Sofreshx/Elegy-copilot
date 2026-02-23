# WU-103: Production-intent Copilot CLI ACP container
# - Non-root user (UID 1001)
# - EXPOSE 3000
# - Proper signal handling via dumb-init
# - Pinned Copilot CLI version (matches WU-101 spike)
# - No secrets baked into the image; auth must be provided at runtime via env (e.g., GH_TOKEN)

FROM node:20-bookworm-slim

# Install minimal OS deps:
# - ca-certificates: TLS
# - dumb-init: correct signal handling + reaping
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Copilot CLI (pinned)
# NOTE: Version pinned to match WU-101 spike validation.
RUN npm install -g @github/copilot@0.0.414 \
  && copilot --version \
  && npm cache clean --force

# Create non-root user (UID 1001)
RUN groupadd -g 1001 copilot \
  && useradd -m -u 1001 -g 1001 -s /bin/bash copilot

ENV HOME=/home/copilot
ENV COPILOT_HOME=/home/copilot/.copilot

# Seed engine assets into the image so sandboxes have the org's agents/skills/prompts by default.
# (If a caller bind-mounts /home/copilot/.copilot, these baked assets will be hidden.)
RUN mkdir -p "$COPILOT_HOME" \
  && chown -R copilot:copilot "$COPILOT_HOME"

COPY --chown=copilot:copilot engine-assets/agents/ $COPILOT_HOME/agents/
COPY --chown=copilot:copilot engine-assets/skills/ $COPILOT_HOME/skills/
COPY --chown=copilot:copilot engine-assets/prompts/ $COPILOT_HOME/prompts/
COPY --chown=copilot:copilot engine-assets/copilot-instructions.md $COPILOT_HOME/copilot-instructions.md

USER copilot
WORKDIR /home/copilot/work

# ACP server port (container always listens on 3000; host port mapping is handled outside this image)
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]

# Runtime requirements:
# - Provide auth via environment (recommended: GH_TOKEN)
# - Bind-mount session-state as needed (e.g., /home/copilot/.copilot/session-state)
CMD ["bash", "-lc", "exec copilot --acp --port 3000 ${COPILOT_ALLOW_ALL_TOOLS:+--allow-all-tools}"]
