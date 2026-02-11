# Local Agent Tracker

Lightweight Node.js service that runs locally alongside VS Code. It watches for agent session changes (Executive3 DB, task files, git status) and bridges them to the cloud relay via WebSocket.

## Overview

The tracker monitors:
- **E3 sessions** — reads `.e3-local/executive3.db` for session state changes
- **Task files** — watches `.instructions/tasks/` for task status updates
- **Git status** — polls workspace repos for branch, ahead/behind, and working-tree changes
- **Relay bridge** — forwards snapshots to the cloud relay over WebSocket

It also exposes a local WebSocket server (default port `9821`) for the VS Code extension to connect to.

## Setup

```bash
npm install
npm run build
```

## Development

```bash
npm run dev
```

## Configuration

All configuration is via environment variables (or a `.env` file):

| Variable | Default | Description |
|---|---|---|
| `TRACKER_WORKSPACE_PATHS` | `.` | Comma-separated workspace paths to watch |
| `TRACKER_RELAY_URL` | — | Cloud relay WebSocket URL |
| `TRACKER_RELAY_TOKEN` | — | Auth token for the relay |
| `TRACKER_WS_PORT` | `9821` | Local WebSocket server port |
| `TRACKER_WATCH_INTERVAL` | `2000` | Polling interval in ms |
| `TRACKER_E3_DB_PATH` | — | Path to the Executive3 SQLite DB |
