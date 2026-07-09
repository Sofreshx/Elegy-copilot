FROM node:22-bookworm AS validate

WORKDIR /workspace

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    make \
    g++ \
    python3 \
    curl \
    build-essential \
    pkg-config \
    libssl-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libsoup-3.0-dev \
    libjavascriptcoregtk-4.1-dev \
    libwebkit2gtk-4.1-dev \
  && rm -rf /var/lib/apt/lists/*

ENV CARGO_HOME=/usr/local/cargo
ENV RUSTUP_HOME=/usr/local/rustup
ENV PATH=/usr/local/cargo/bin:$PATH

RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable

COPY . .

RUN npm ci
RUN node copilot-ui/scripts/tauri-updater-feed.test.js
RUN node --test copilot-ui/lib/desktop-shell/githubReleaseUpdaterClient.test.js
RUN npm --prefix copilot-ui run test:vitest -- desktop-updater-store desktop-updater-ui desktop-updater-presentation
RUN npm --prefix local-tracker run build
RUN npm --prefix copilot-ui run build:tauri-runtime-host
RUN npm --prefix copilot-ui run validate:tauri-node-sidecar-layout
RUN npm --prefix copilot-ui run ui:build
RUN npm --prefix copilot-ui run tauri:check:linux
RUN cargo test --manifest-path copilot-ui/src-tauri/Cargo.toml runtime_root_resolver
RUN cargo check --manifest-path copilot-ui/src-tauri/Cargo.toml
