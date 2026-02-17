# Local Agent Tracker

Lightweight Node.js service that runs locally alongside VS Code. It watches for task file and git changes, and also hosts the Discord-first Messaging Gateway for remote control.

## Overview

The tracker monitors:
- **Task files** — watches `.instructions/tasks/` for task status updates
- **Git status** — polls workspace repos for branch, ahead/behind, and working-tree changes
- **Relay bridge** — forwards snapshots to the cloud relay over WebSocket

It also exposes a local WebSocket server (default port `9821`) for the VS Code extension to connect to.

## Messaging Gateway

For the Discord-first Messaging Gateway (remote control surface), see:
- [docs/messaging-gateway.md](docs/messaging-gateway.md)

## Setup

```bash
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Authentication

The tracker needs a **relay token** to authenticate when forwarding events to the cloud relay. The token is a relay-issued JWT obtained via `POST /auth/exchange` (GitHub token → relay JWT) or pre-provisioned by an admin.

### Setting the token

**Environment variable (recommended):**

```bash
# Linux / macOS — add to your shell profile (~/.bashrc, ~/.zshrc, etc.)
export TRACKER_RELAY_TOKEN="eyJhbGciOi..."

# Windows — use the system environment variable UI or:
$env:TRACKER_RELAY_TOKEN = "eyJhbGciOi..."
```

**OS keychain (future):**
A future release will support reading the token from the OS credential store (macOS Keychain, Windows Credential Manager, libsecret on Linux). The tracker will fall back gracefully if keychain access is unavailable.

### Resolution order

The `TrackerAuth` class resolves credentials in priority order:

1. `TRACKER_RELAY_TOKEN` environment variable
2. OS keychain (future — gracefully skipped if unavailable)
3. Manual prompt (future)

### Token validation

Before connecting, the tracker validates the token's structure (three-part base64url JWT, required header/payload fields, expiration). It does **not** verify the cryptographic signature — that is the relay's responsibility.

### Security

- **Never** store tokens in `.env` files, config files, or source code.
- Use environment variables set outside the repo (shell profile, OS env settings) or the OS keychain.
- Tokens are held in memory only for the lifetime of the tracker process.
- Future: automatic token refresh before expiration.

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `TRACKER_WORKSPACE_PATHS` | `.` | Comma-separated workspace paths to watch |
| `TRACKER_RELAY_URL` | — | Cloud relay WebSocket URL |
| `TRACKER_RELAY_TOKEN` | — | Auth token for the relay (see [Authentication](#authentication)) |
| `TRACKER_WS_PORT` | `9821` | Local WebSocket server port |
| `TRACKER_WATCH_INTERVAL` | `2000` | Polling interval in ms |
