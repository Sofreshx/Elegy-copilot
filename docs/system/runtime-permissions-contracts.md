---
created: 2026-02-25
updated: 2026-02-26
category: system
status: current
doc_kind: node
id: runtime-permissions-contracts
summary: Canonical runtime and Copilot permissions contracts for API behavior, non-Docker primary runtime policy, fallback compatibility, and dynamic location authorization.
tags: [runtime, permissions, contracts, copilot-ui]
related: [security-model, system-docs-index]
---

# Runtime + Permissions Contracts

## Scope

This document is the canonical contract for:
- Runtime capability payloads emitted by `copilot-ui/server.js`.
- Runtime provider policy for sandbox lifecycle routing (non-Docker primary, Docker supported).
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

## Runtime Provider Policy Contract (G-01-WU-01)

This section freezes runtime routing policy for downstream implementation.

1. Primary runtime path
  - Non-Docker runtime is the primary execution path for sandbox lifecycle operations.
  - Docker remains supported as an optional provider path.

2. Capability interpretation
  - `capabilities.docker` is an optional capability indicator and MUST NOT be treated as a mandatory prerequisite for lifecycle operations.
  - `capabilities.sandbox` indicates sandbox lifecycle availability independent of Docker availability.

3. Fallback behavior
  - If non-Docker runtime is unavailable and Docker is available, implementations MAY route lifecycle operations through Docker.
  - If both non-Docker and Docker runtime paths are unavailable, lifecycle operations MUST fail closed with explicit unavailability signaling.

4. Contract-shape compatibility
  - This policy freeze does not require new `/api/health` fields in runtime contract version `1.0.0`.
  - Existing health consumers remain compatible while provider routing behavior is aligned in implementation work.

5. WS6 sequencing gate (G-06-WU-01)
  - WS6 compatibility/release-safety work MUST start only after the WS1 contract freeze gate is complete (`G-01-WU-04`).
  - WS6 enforcement is limited to compatibility and upgrade-safety controls and MUST NOT redefine primary runtime defaults.

6. Ownership boundary (WS2 vs WS6)
  - WS2 owns primary non-Docker default behavior and provider-state parity guardrails.
  - WS6 may only constrain compatibility/upgrade safety behavior (mixed-version handling, rollback controls, release safety gates) for non-Docker paths.

## WS6 Release Readiness Evidence Contract (G-06-WU-04)

WS6 release readiness is contractually valid only when the following evidence artifacts are produced and reviewed together.

1. `WS6-E1 ScopeOwnership`
  - Source: `docs/system/runtime-permissions-contracts.md` and `README.md`.
  - Requirement: both documents preserve WS6 sequencing (post-WS1 freeze) and WS2 ownership of primary non-Docker default behavior.

2. `WS6-E2 MixedVersionMatrix`
  - Source: `node copilot-ui/server.lifecycle-proxy.test.js` and `npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/gatewayHttpServer.test.ts`.
  - Requirement: evidence includes deterministic unsupported marker (`code=lifecycle_compatibility_unsupported`) and deterministic supported path (`reason=compatibility_supported`) for mixed-version lifecycle checks.

3. `WS6-E3 ChecksumSafety`
  - Source: `node copilot-ui/lib/planningPersistence.test.js` and `node copilot-ui/server.runtime-health.test.js`.
  - Requirement: checksum pass path remains `all_manifest_checksums_match`; checksum drift remains hard-fail (`PLANNING_MIGRATION_CHECKSUM_DRIFT`); runtime health reports deterministic `planningPersistence.migrations.driftDetected` state.

4. `WS6-E4 RollbackTriggers`
  - Source: `node copilot-ui/dist-electron/rollbackPolicy.test.js` and `node copilot-ui/dist-electron/updatePolicy.rollback.test.js`.
  - Requirement: threshold trigger reasons remain machine-readable and deterministic (`rollback_policy_source_unavailable`, `rollback_policy_malformed`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`).

5. `WS6-E5 KillSwitch`
  - Source: `node copilot-ui/dist-electron/updater.rollback.test.js` plus operational approval record.
  - Requirement: kill-switch evidence includes `updates_disabled_globally` blocking update checks and ownership/approval record aligned with Security Model (Release Engineering execution, incident commander approval, Security co-approval for trust-chain incidents).

Pass/fail contract:
- **Pass**: all `WS6-E1`..`WS6-E5` artifacts are present and all referenced commands exit `0`.
- **Fail**: any artifact is missing, any required marker/reason is absent, or any referenced command fails.
- A fail state is release-blocking until corrected evidence is regenerated.

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
- `copilot-ui/VALIDATION.md` → **WS2 — Provider SSOT + Parity Guardrails (G-02-WU-04)**
- `copilot-ui/VALIDATION.md` → **WS6 — Compatibility + Upgrade Safety Scope Gate (G-06-WU-01)**
- `copilot-ui/VALIDATION.md` → **WS6 — Release Readiness Evidence Gate (G-06-WU-04)**
