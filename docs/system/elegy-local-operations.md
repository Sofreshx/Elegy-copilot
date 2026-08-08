---
created: 2026-08-06
updated: 2026-08-06
category: system
status: current
doc_kind: node
id: elegy-local-operations
summary: Fixed local operator boundary for Copilot, tracker, Overseer, and OWM.
tags: [operations, local, tracker, copilot-ui, overseer, opportunity-world-model]
---

# Elegy local operations

The source-owned Windows operator scripts start and stop the Copilot UI and
local tracker as two fixed Node processes. They bind the existing loopback
surfaces: Copilot UI on 127.0.0.1:3210 and tracker status on 127.0.0.1:9822.

From the repository root:

```powershell
pwsh -File scripts/status-local.ps1 -Json
pwsh -File scripts/start-local.ps1
pwsh -File scripts/stop-local.ps1
```

The operator stores only PID, fixed entrypoint, executable, port, repository
fingerprint, and local log paths under the user-local ElegyCopilot operator
directory. It does not store relay tokens or copy process output into
Overseer. Missing Node dependencies or a missing tracker build produce manual
instructions; the scripts never run npm install, build automatically, fetch
images, or broaden environment state.

Stop verifies the current repository fingerprint, process executable, and
entrypoint command line before terminating a PID. If verification fails, it
stops and requires manual inspection. A partial start remains observable as a
degraded local state rather than silently terminating the healthy component.

Overseer may invoke only these fixed scripts after an authenticated cockpit
confirmation. Elegy remains the authority for UI, tracker, session, host
integration, and repository/worktree operations.

## Hosted intelligence consoles

Elegy has dedicated **Overseer** and **Opportunity Intelligence (OIE)** tabs. Their host API uses
two fixed descriptors only:

| Service | Checkout marker | Origin | Fixed scripts |
|---------|-----------------|--------|---------------|
| Overseer | `../../overseer/package.json` | `http://127.0.0.1:4173` | `scripts/status-overseer.ps1`, `scripts/start-overseer.ps1`, `scripts/stop-overseer.ps1` |
| Opportunity Intelligence (OIE) | `../opportunity-world-model/Cargo.toml` | `http://127.0.0.1:7400` | `scripts/status-local.ps1`, `scripts/start-local.ps1`, `scripts/stop-local.ps1` |

The tab first reports `stopped`, `starting`, `ready`, `degraded`,
`unavailable`, or `prerequisite_missing`. Start and Stop require the exact
service-specific confirmation plus the latest observed status timestamp; a
stale status is rejected before any operator script runs. Actions execute only
the source-owned script in the known checkout. Elegy never proxies either service's API, transports process
output, reads credentials/cookies/private records, or persists domain data.
Missing checkouts, scripts, dependencies, occupied ports, malformed health
responses, timeouts, and crashes stay visible as recoverable diagnostics.

When ready, the service console is framed directly at its loopback origin with
the `embed=elegy` hint. The source service retains its navigation, approvals,
warnings, provenance, session token/cookie, PostgreSQL state, and release or
research gates. The embedding parent must use a loopback origin, but that
parent origin may be ephemeral rather than fixed to a specific port. Switching
tabs unmounts a frame but does not stop the
underlying process; Stop is always explicit.
