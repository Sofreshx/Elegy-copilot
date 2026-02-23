---
created: 2026-02-23
updated: 2026-02-23
category: system
status: draft
doc_kind: node
id: spike-cli-auth
summary: WU-101 auth spike for running Copilot CLI ACP in a container and verifying session-state bind mounts.
tags: [sandbox-orchestrator, spike, copilot-cli, acp, docker]
related: [copilot-cli-playbook, auth-architecture-adr]
---

# WU-101 Spike — Copilot CLI ACP in Docker (Auth + session-state bind mount)

## Goal

Prove (or disprove) that **Copilot CLI can run in a container** in ACP server mode and successfully:

1. Authenticate
2. Accept an ACP JSON-RPC client connection
3. Complete one `session/new` + `session/prompt`
4. Write session artifacts to a **host bind mount** at `~/.copilot/sandboxes/<id>/session-state/`

This is a **go/no-go** gate for the Sandbox Orchestrator plan.

## Prerequisites

- Docker Desktop running (Linux containers)
- Node.js available on host (only needed for repo tooling)
- Copilot CLI is installable via npm in the image (`npm install -g @github/copilot@<version>`)

## Spike assets (in this repo)

- Dockerfile: [local-tracker/docker/spike-cli-auth.Dockerfile](local-tracker/docker/spike-cli-auth.Dockerfile)
- Entrypoint: [local-tracker/scripts/spike-cli-auth-entrypoint.sh](local-tracker/scripts/spike-cli-auth-entrypoint.sh)
- ACP client: [local-tracker/scripts/spike-acp-invoke.mjs](local-tracker/scripts/spike-acp-invoke.mjs)

## Build

From the repo root (`instruction-engine/`):

```powershell
docker build -f local-tracker/docker/spike-cli-auth.Dockerfile -t ie-spike-cli-auth .
```

## Run (attempt A: token env)

This is the cleanest path if Copilot CLI honors a token environment variable in ACP mode.

```powershell
$sandboxId = "spike-01"
$hostSessionState = "$env:USERPROFILE/.copilot/sandboxes/$sandboxId/session-state"
New-Item -ItemType Directory -Force -Path $hostSessionState | Out-Null

docker run --rm \
  -e COPILOT_GITHUB_TOKEN=$env:COPILOT_GITHUB_TOKEN \
  -e GH_TOKEN=$env:GH_TOKEN \
  -e GITHUB_TOKEN=$env:GITHUB_TOKEN \
  -e ACP_PORT=3000 \
  -p 127.0.0.1:13001:3000 \
  -v "${hostSessionState}:/home/copilot/.copilot/session-state" \
  ie-spike-cli-auth
```

Expected (success): container logs include:
- `[spike] ACP port open`
- `[spike] connected to ACP 127.0.0.1:3000`
- `[spike] initialize: ok`
- `[spike] session/new: <sessionId>`
- `[spike] session/prompt done ...`

Host verification:
- A new directory appears under `$hostSessionState` (or files inside it, depending on CLI version).

## Run (attempt B: reuse host login state)

If token env vars are not supported, this is the fallback:

1) Authenticate on the host:

```powershell
copilot
# then run: /login
# or: copilot login
```

2) Mount the host Copilot home into the container:

```powershell
$hostCopilotHome = "$env:USERPROFILE/.copilot"

docker run --rm \
  -e ACP_PORT=3000 \
  -p 127.0.0.1:13001:3000 \
  -v "${hostCopilotHome}:/home/copilot/.copilot" \
  ie-spike-cli-auth
```

Expected: same as attempt A, plus the session-state artifacts should land under the bind-mounted `~/.copilot/session-state/`.

## Known failure modes

- **`copilot` exits immediately**: likely an unsupported CLI flag. This spike intentionally uses only `--acp --port <N> --allow-all-tools`.
- **ACP port opens but `session/new` fails**: indicates ACP protocol mismatch or auth state not usable.
- **No session-state output**: verify `HOME=/home/copilot` and that `~/.copilot/session-state/` is writable/mounted.

## Results

### Environment

- Host OS: Windows
- Docker: Docker Desktop (linux/amd64) — client 27.5.1-rd, server 29.2.1
- Image base: `node:20-bookworm-slim`
- Copilot CLI version in image: 0.0.414

### Verdict

- Token env auth:
  - `GH_TOKEN` from `gh auth token`: **GO** (ACP initialize + `session/new` + `session/prompt` succeeded; session-state directory written to sandbox bind mount)
  - `COPILOT_GITHUB_TOKEN` / `GITHUB_TOKEN`: **NOT TESTED** in this environment (no env vars were present)
- Host-login bind-mount auth (mounting only `~/.copilot`): **NO-GO** (ACP returned `{"code":-32000,"message":"Authentication required"}`)

**Overall WU-101 verdict:** **GO (with `GH_TOKEN` injection)**

### Notes / next steps

- Container auth appears to require an explicit token injection (at least `GH_TOKEN`). Host Copilot home bind-mount alone did not satisfy authentication.
- If **GO**, proceed to WU-102/WU-103/WU-105.
