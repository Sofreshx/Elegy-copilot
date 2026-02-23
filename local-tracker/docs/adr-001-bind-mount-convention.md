---
created: 2026-02-23
updated: 2026-02-23
category: system
status: current
doc_kind: node
id: adr-001-bind-mount-convention
summary: Canonical bind-mount path convention for sandbox session-state (host layout, in-container HOME, and nested mounts).
tags: [adr, sandbox-orchestrator, docker, bind-mount, session-state]
related: [spike-cli-auth, session-state-artifacts, auth-architecture-adr]
---

# ADR-001 — Bind-Mount Path Convention (Sandbox Session-State)

## Scope

This ADR defines the **canonical host path** and **in-container path** for Copilot CLI session-state artifacts when running `copilot --acp` inside Docker-managed sandboxes.

## Decision

### Canonical host path (authoritative)

All sandbox session artifacts MUST be written under:

```
~/.copilot/sandboxes/<sandbox-id>/session-state/
```

### In-container path (authoritative)

Inside the container, session-state MUST resolve to:

```
/home/copilot/.copilot/session-state/
```

Set:

- `HOME=/home/copilot`

so `~/.copilot/session-state/` inside the container maps to `/home/copilot/.copilot/session-state/`.

## Allowed bind-mount strategies

### A) Direct session-state bind mount (preferred)

Bind-mount only the sandbox’s session-state directory:

- Host: `~/.copilot/sandboxes/<sandbox-id>/session-state/`
- Container: `/home/copilot/.copilot/session-state/`

Example (PowerShell-friendly paths):

```powershell
$sandboxId = "sandbox-01"
$hostSessionState = "$env:USERPROFILE/.copilot/sandboxes/$sandboxId/session-state"
New-Item -ItemType Directory -Force -Path $hostSessionState | Out-Null

docker run --rm \
  -e HOME=/home/copilot \
  -v "${hostSessionState}:/home/copilot/.copilot/session-state" \
  <image>
```

### B) Nested bind-mount for credentials + isolation (allowed for spike/prod)

This is a **two-mount** approach:

1) Mount host `~/.copilot` into the container for **credentials/config**.
2) Mount sandbox session-state over the container’s `~/.copilot/session-state` to ensure **sandbox isolation**.

Mounts:

- `~/.copilot` → `/home/copilot/.copilot`
- `~/.copilot/sandboxes/<sandbox-id>/session-state` → `/home/copilot/.copilot/session-state`

Notes:
- The second mount intentionally **shadows** the `session-state/` folder from the first mount.
- Ensure the session-state mount is applied (listed) after the broad `~/.copilot` mount.

## Fallback (when bind mounts aren’t feasible)

If bind mounts cannot be used (policy restrictions, remote Docker context, filesystem permission issues), use **copy-out** from the container filesystem.

Example:

```powershell
# Keep container around long enough to copy (avoid --rm)
$containerId = docker create \
  -e HOME=/home/copilot \
  <image>

docker start -a $containerId

docker cp "${containerId}:/home/copilot/.copilot/session-state/." \
  "$env:USERPROFILE/.copilot/sandboxes/<sandbox-id>/session-state/"

docker rm $containerId
```

Tradeoff: copy-out is not suitable for “live” UI reading while the sandbox runs, but it preserves artifacts for inspection and debugging.
