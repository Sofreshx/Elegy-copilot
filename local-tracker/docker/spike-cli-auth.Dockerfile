# WU-101 SPIKE: containerized Copilot CLI + ACP invocation
# Purpose: prove auth + ACP handshake + agent invocation + host bind-mount session-state.
# Keep this minimal; not production-hardened.

FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates dumb-init netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Match host Copilot CLI version observed in WU-101 (0.0.414)
RUN npm install -g @github/copilot@0.0.414 \
  && copilot --version

# Non-root user (matches planned production posture, but this is only a spike)
RUN useradd -m -u 1001 -s /bin/bash copilot

# Engine assets are copied into the image so the spike can run without relying on host state.
# Note: if you bind-mount /home/copilot/.copilot, those baked-in assets will be hidden.
COPY engine-assets /opt/instruction-engine/engine-assets
COPY local-tracker/scripts/spike-acp-invoke.mjs /opt/instruction-engine/spike-acp-invoke.mjs
COPY local-tracker/scripts/spike-cli-auth-entrypoint.sh /opt/instruction-engine/spike-cli-auth-entrypoint.sh

RUN chmod +x /opt/instruction-engine/spike-cli-auth-entrypoint.sh

USER copilot
ENV HOME=/home/copilot
WORKDIR /home/copilot/work

ENTRYPOINT ["dumb-init", "--"]
CMD ["/opt/instruction-engine/spike-cli-auth-entrypoint.sh"]
