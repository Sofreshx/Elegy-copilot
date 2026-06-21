---
created: 2026-02-23
updated: 2026-05-25
category: system
status: current
doc_kind: node
id: auth-architecture-adr
summary: Historical auth architecture ADR for retired sandbox-orchestrator surfaces.
tags: [security, auth, adr, sandbox-orchestrator]
related: [security-model, session-state-artifacts, adr-governance]
---

# Auth Architecture ADR — Sandbox Orchestrator (WU-501)

## Scope

This ADR records historical auth surfaces introduced by the retired sandbox-orchestrator plan.

- Local Copilot CLI **ACP** TCP server (loopback-only)
- The Discord gateway and UI gateway bridge described below are retired.

Out of scope: remote notification pipelines (message brokers, remote approval relays, etc.).

Out of scope: auth for the existing Elegy Copilot cloud relay/mobile/extension ecosystem (see docs/system/security-model.md).

## Context

This ADR records the auth surfaces introduced by the sandbox-orchestrator work because they define
trust boundaries, possession rules, and mutation authority that future implementation and review work
must preserve.

## Decision

Adopt a **layered, possession-based** trust model:

- Prefer **loopback-only channels** when both parties run on the same host.
- Prefer **OS credential store / secret managers** for long-lived secrets.

Remote notification/relay systems are explicitly deferred and out of scope for this ADR.

## Token hierarchy (what exists, where it lives, what it can do)

Ordered from “most local / foundational” to “most remote / easiest to misuse”:

1. **ACP (no token; loopback boundary)**
   - What it is: Copilot CLI ACP TCP server (JSON-RPC over TCP)
   - Auth: **none** (relies on `127.0.0.1` binding and host firewall)
   - Privilege: full control of agent sessions exposed by that ACP server

2. **Discord bot token (stored in OS keychain)**
   - What it is: Discord application bot token used by `local-tracker`
   - Storage: OS credential store (with env fallback for bootstrap)
   - Privilege: can post/read within the configured guild/channel scope

3. **`copilot-ui` ↔ `local-tracker` shared secret (server-to-server)**
   - What it is: a random shared secret used to authenticate mutation requests from UI → gateway
   - Storage intent: OS credential store; provided to `copilot-ui` as an environment variable at startup
   - Privilege: ability to approve/deny permissions and perform other gateway mutations exposed via HTTP

## Trust boundaries (the three boundaries this ADR covers)

| # | Boundary | Parties | Trust assertion | Mutating capability gated by |
|---|----------|---------|-----------------|------------------------------|
| TB-1 | ACP localhost | `local-tracker` ↔ Copilot CLI (`copilot --acp`) | “Only local processes can reach ACP” | loopback bind + host firewall (no token) |
| TB-2 | Discord bot token | `local-tracker` ↔ Discord API | “This process is the bot” | bot token possession + channel/guild scoping |
| TB-3 | UI↔Gateway shared secret | `copilot-ui` ↔ `local-tracker` | “This request came from the trusted UI server” | shared secret in HTTP header |

## Canonical role-action matrix (G-04-WU-01)

This matrix is authoritative for sandbox lifecycle actions exposed by the control plane:

| Action | Local UI operator (authn passed) | Discord allowlisted operator | Unauthenticated / out-of-scope caller |
|---|---|---|---|
| `create` | allow | allow | deny |
| `start` | allow | allow | deny |
| `stop` | allow | allow | deny |
| `open-terminal` | allow (local-machine only) | deny | deny |
| `pr-open` | allow (host-only token mediation) | allow (host-only token mediation) | deny |

Rules:
- `open-terminal` is never granted via remote Discord-only initiation.
- `pr-open` uses host-side credentials only; credentials are never injected into sandbox containers.
- Deny decisions are fail-closed and return deterministic error contracts.

## Threats & mitigations (by boundary)

### TB-1: ACP localhost (no token)

Threats:
- A non-admin local process connects to ACP and issues privileged JSON-RPC calls.
- ACP port is accidentally bound to `0.0.0.0` or exposed via Docker port publishing beyond loopback.
- Local malware uses ACP as a “command execution” proxy via the agent tool surface.

Mitigations:
- Bind ACP to `127.0.0.1` only; never intentionally expose ACP on LAN.
- Treat ACP as equivalent to “local code execution”; assume compromise if host is compromised.
- Prefer an allocated host-port range and avoid well-known ports to reduce accidental exposure.

### TB-2: Discord bot token

Threats:
- Token leakage through logs, crash dumps, or accidental check-in.
- Token theft from environment variables or process memory.
- Bot used in the wrong guild/channel to accept commands outside the intended scope.

Mitigations:
- Store token in OS credential store; use env vars only as a transient bootstrap path.
- Never log the token; avoid including it in errors.
- Enforce guild/channel scoping and a user allowlist in gateway configuration.
- Keep bot permissions minimal (only what the gateway needs).

### TB-3: `copilot-ui` ↔ `local-tracker` shared secret

Threats:
- An attacker on the same host (or on the LAN, if bound broadly) can call mutation endpoints.
- Secret is exfiltrated to the browser (e.g., injected into client JS) or leaked in URLs.
- Replay of captured requests if HTTP is exposed beyond loopback.

Mitigations:
- Bind both services to loopback for local dev; treat non-loopback binding as requiring HTTPS.
- Authenticate gateway mutation endpoints with a shared secret passed in an HTTP header (Bearer-style).
- Compare secrets in constant-time and never accept secrets via query params.
- Do not persist the shared secret to plaintext repo files; store in OS keychain where possible.

## Non-goals

- Not building a general multi-user authentication/authorization system for the UI or gateway.
- Not supporting internet-exposed ACP servers.
- Not defining token formats for the legacy Elegy Copilot relay ecosystem.
- Not solving “host is compromised” (local malware) — if the developer machine is compromised, these boundaries are not sufficient.

## Consequences

- Security posture depends heavily on **loopback binding** and **secret hygiene**.
- Remote approvals are possible but intentionally constrained; local control remains the primary authority.

## Validation notes

- This ADR is designed to be checked by the doc validator (frontmatter + structure).
- Future work units (WU-553/WU-554) implement the shared-secret middleware and its unit tests described here.
