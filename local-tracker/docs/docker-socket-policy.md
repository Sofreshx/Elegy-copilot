---
created: 2026-02-23
updated: 2026-03-16
category: system
status: current
doc_kind: node
id: docker-socket-policy
summary: Security policy for Docker socket access in sandbox orchestration
tags: [security, docker, policy, sandbox-orchestrator]
related: [auth-architecture-adr, adr-001-bind-mount-convention]
---

# Docker Socket Access Policy

## Problem

Docker socket (`/var/run/docker.sock`) access is effectively root-equivalent on the host. This policy applies only when the optional messaging-gateway / sandbox-orchestration runtime is enabled under `local-tracker/`; the baseline tracker loop does not require Docker socket access. The optional gateway process needs socket access to manage sandbox containers via `dockerode` (see `containerManager.ts`).

## Policy Decisions

| Decision | Rationale |
|----------|-----------|
| Gateway runs as regular user in `docker` group — never root | Limits blast radius if gateway process is compromised |
| Sandbox containers do **not** receive Docker socket access | Prevents container escape / spawning sibling containers |
| Docker API is unix socket only (never network-exposed) | Eliminates remote unauthenticated Docker API attacks |
| Only containers labeled `ie.sandbox=true` are managed | `reconcile()` only touches labeled containers — no accidental interference |
| Container names follow `ie-sandbox-<sandboxId>` pattern | Validated alphanumeric + hyphens; prevents injection via crafted sandbox IDs |

## Sandbox Action Authorization Matrix (G-04-WU-01)

| Action | Local UI operator (authenticated) | Discord allowlisted operator | Untrusted caller |
|---|---|---|---|
| `create` | allow | allow | deny |
| `start` | allow | allow | deny |
| `stop` | allow | allow | deny |
| `open-terminal` | allow (local-machine only) | deny | deny |
| `pr-open` | allow (host token only) | allow (host token only) | deny |

Matrix rules:
- `open-terminal` is restricted to local-machine initiation only.
- `pr-open` uses host-owned token material; token data is never injected into sandbox containers.
- All denied actions are fail-closed.

## Mitigations

- **Non-root user in containers** — UID 1001 per `copilot-cli-acp.Dockerfile`
- **Resource limits** — CPU quota + memory limit enforced via `ContainerManager`
- **Max sandboxes guardrail** — prevents resource exhaustion on the host
- **Loopback-only port binding** — ACP ports bound to `127.0.0.1`, not `0.0.0.0`
- **No `--privileged` flag** — containers run unprivileged
- **No Docker-in-Docker** — no socket mount into sandbox containers

## Windows / WSL2 Notes

- Docker Desktop for Windows runs the daemon inside a WSL2 VM
- `docker` group membership is handled by the Docker Desktop installer
- Named pipe `//./pipe/docker_engine` replaces the unix socket on the Windows host
- The same security boundary applies: gateway can manage containers, sandboxes cannot

## Verification Checklist

```bash
# Confirm no privileged mode, no socket mount, non-root user, resource limits, loopback binding
docker inspect ie-sandbox-*

# List only gateway-managed containers
docker ps --filter label=ie.sandbox=true
```

Inspected containers should show:

- `Privileged: false`
- No `/var/run/docker.sock` bind mount
- `User` set to non-root (UID 1001)
- `Memory` and `CpuQuota` limits present
- Port bindings on `127.0.0.1` only
