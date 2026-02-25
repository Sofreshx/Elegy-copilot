---
created: 2026-02-25
updated: 2026-02-25
category: system
status: current
doc_kind: node
id: runtime-permissions-contracts
summary: Canonical runtime and Copilot permissions contracts for API behavior, fallback compatibility, and dynamic location authorization.
tags: [runtime, permissions, contracts, copilot-ui]
related: [security-model, system-docs-index]
---

# Runtime + Permissions Contracts

## Scope

This document is the canonical contract for:
- Runtime capability payloads emitted by `copilot-ui/server.js`.
- Copilot permissions location authorization used by `scripts/vscode-settings-patch.mjs` and `POST /api/copilot/authorize`.

## Runtime Contract

### Contract source
- `copilot-ui/lib/runtimeContracts.js`
- `GET /api/health` in `copilot-ui/server.js`

### Shape

```json
{
  "contractVersion": "1.0.0",
  "mode": "repo | packaged",
  "capabilities": {
    "docker": "available | unavailable | unknown",
    "sandbox": "available | unavailable | unknown",
    "wsl2": "available | unavailable | unknown"
  }
}
```

### Deterministic behavior

1. `mode`
   - Uses `INSTRUCTION_ENGINE_RUNTIME_MODE` when set.
   - Falls back to packaged detection (`app.asar` / packaged hint).
   - Defaults to `repo`.

2. `capabilities`
   - Always includes `docker`, `sandbox`, and `wsl2` keys.
   - Uses states `available`, `unavailable`, `unknown`.
   - Supports explicit test overrides via:
     - `INSTRUCTION_ENGINE_FORCE_DOCKER_STATE`
     - `INSTRUCTION_ENGINE_FORCE_WSL2_STATE`
     - `INSTRUCTION_ENGINE_FORCE_SANDBOX_STATE`

3. API stability
   - `/api/health` always includes a `runtime` object with `contractVersion`, `mode`, and `capabilities`.

## Permissions Contract

### Contract source
- `copilot-ui/lib/permissionsContracts.js`
- `copilot-ui/lib/permissionLocationsResolver.js`
- `scripts/vscode-settings-patch.mjs`
- `patchCopilotPermissionsConfig()` in `copilot-ui/server.js`

### Location model

Authorization locations are built from:
1. Base roots (`~/.copilot` and configured VS Code asset root)
2. Default subdirs:
   - `agents`, `skills`, `prompts`, `session-state`, `repo-state`, `sessions-archive`
3. Dynamically discovered first-level subdirectories under each base root

### Guarantees

- Paths are absolute, normalized, de-duplicated, and sorted deterministically.
- Escaping paths (`..`, invalid absolute mapping) are rejected.
- Each location receives default `tool_approvals` for:
  - `read`
  - `write`
  - `memory`
- Re-running authorization is idempotent (no duplicate approval entries).

## Validation

Run narrow tests:

```bash
node copilot-ui/lib/permissionsContracts.test.js
node copilot-ui/lib/permissionLocationsResolver.test.js
node scripts/vscode-settings-patch.test.mjs
node copilot-ui/lib/runtimeContracts.test.js
node copilot-ui/server.runtime-health.test.js
```

Manual checks:
- `copilot-ui/VALIDATION.md` → **WS3 — Runtime Compatibility Contract (G-01-WU-03)**
