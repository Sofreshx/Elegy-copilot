---
created: 2026-02-25
updated: 2026-02-27
category: system
status: current
doc_kind: node
id: runtime-permissions-contracts
summary: Canonical runtime and permissions contracts for API behavior, non-Docker primary runtime policy, and fallback compatibility.
tags: [runtime, permissions, contracts, copilot-ui]
related: [security-model, system-docs-index]
---

# Runtime + Permissions Contracts

## Scope

This document is the canonical contract for:
- Runtime capability payloads emitted by `copilot-ui/server.js`.
- Runtime provider policy for sandbox lifecycle routing (non-Docker primary, Docker supported).
- Runtime permission contract helpers used by the desktop sidecar and validation suite.

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
  - Source: `npm --prefix copilot-ui run test:vitest -- src/rollbackPolicy.test.ts src/updatePolicy.rollback.test.ts`.
  - Requirement: threshold trigger reasons remain machine-readable and deterministic (`rollback_policy_source_unavailable`, `rollback_policy_malformed`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`).

5. `WS6-E5 KillSwitch`
  - Source: `npm --prefix copilot-ui run test:vitest -- src/rollbackPolicy.test.ts` plus operational approval record.
  - Requirement: kill-switch evidence includes `updates_disabled_globally` blocking update checks and ownership/approval record aligned with Security Model (Release Engineering execution, incident commander approval, Security co-approval for trust-chain incidents).

Pass/fail contract:
- **Pass**: all `WS6-E1`..`WS6-E5` artifacts are present and all referenced commands exit `0`.
- **Fail**: any artifact is missing, any required marker/reason is absent, or any referenced command fails.
- A fail state is release-blocking until corrected evidence is regenerated.

## WS6 CI Topology + Required-Check Contract (WU-WS6-01 / WU-WS6-03 / WU-WS6-04 / WU-WS6-05)

`.github/workflows/repo-ci.yml` is the fail-closed repo-wide CI topology for pull requests.

1. Fixed topology (authoritative)
  - `.github/workflows/repo-ci.yml` must keep this required dependency chain:
    - `build`
    - `desktop-tauri-preview`
    - `required-checks`

2. Required-check aggregator (strict semantics)
  - `required-checks` runs with `if: always()` and fails unless:
    - `needs.build.result == success`
    - `needs.desktop-tauri-preview.result == success`
  - Missing/skipped/non-success statuses are treated as hard failures.

3. Release gate linkage
  - Desktop packaging remains a separate workflow and is not published from `repo-ci.yml`.
  - Public preview and signed release flows stay in `desktop-preview-release.yml`, `desktop-release.yml`, and `desktop-version-tag.yml`.

## WS6 Narrow-to-Broad Validation + Rollback Contract (WU-WS6-07)

WS6 validation follows this ordered ladder:

1. Narrow static guards
  - `node scripts/validate-manifest.js`
  - `node scripts/validate-doc-graph.js`

2. Compatibility + checksum guards
  - `node copilot-ui/server.lifecycle-proxy.test.js`
  - `npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/gatewayHttpServer.test.ts`
  - `node copilot-ui/lib/planningPersistence.test.js`
  - `node copilot-ui/server.runtime-health.test.js`

3. Rollback + kill-switch guards
  - `npm --prefix copilot-ui run test:vitest -- src/rollbackPolicy.test.ts src/updatePolicy.rollback.test.ts`

Contract result:
- **Pass**: all ladder stages pass and required WS6 artifacts are complete/integrity-verified.
- **Fail**: any stage fails, any required artifact/check is missing, or required-check aggregation is non-success.

## WS4 M2 Corruption Scan + Recovery Write Gate Contract

Planning persistence corruption handling is fail-closed and deterministic:

1. Scan endpoint
  - `POST /api/planning/persistence/corruption/scan` returns a deterministic scan envelope (`blocked`, `recoveryRequired`, `findingCount`, explicit `code`/`reason`).

2. Recovery write gate
  - When scan state indicates corruption (`blocked=true`), planning persistence write operations must fail closed.
  - Blocked write responses use explicit deterministic marker `code=planning_persistence_recovery_required` with recovery reason metadata.

3. Recovery path
  - Write operations remain blocked until a subsequent scan reports clear state (`blocked=false`, `recoveryRequired=false`).
  - This preserves deterministic safety under corruption conditions without introducing file-based fallback writes.

## WS4 M3 Closure Alignment Contract

WS4 closure is complete only when freeze evidence and tracker alignment semantics are both satisfied.

1. Required closure evidence commands
  - `node copilot-ui/lib/planningPersistence.test.js`
  - `node copilot-ui/lib/planningApiContracts.test.js`
  - `node copilot-ui/server.runtime-health.test.js`
  - `npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/lifecycleOperations.test.ts src/messagingGateway/__tests__/gatewayHttpServer.test.ts`

2. Path alignment requirement
   - copilot-ui gateway-state/config surfaces must resolve tracker config deterministically with `INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH` override support.
   - Canonical machine-global default is `~/.copilot/messaging-gateway.config.json`; legacy `~/.instruction-engine` config is compatibility-only rehome input.

3. Idempotency alignment requirement
  - lifecycle retry and conflict behavior remains deterministic and explicit.
  - conflict envelopes must preserve stable code/reason semantics (`idempotency_conflict`, `idempotency_key_payload_mismatch`) with no silent payload drift acceptance.

4. Fail-closed gate semantics
  - any evidence failure or path/idempotency drift is WS4 freeze-blocking for downstream promotion.

## Permissions Contract

### Contract source
- `copilot-ui/lib/permissionsContracts.js`
- `copilot-ui/lib/permissionLocationsResolver.js`

### Location model

Authorization locations are built from:
1. Base roots provided by the caller, with `~/.copilot` remaining the desktop runtime state root.
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
node copilot-ui/lib/runtimeContracts.test.js
node copilot-ui/server.runtime-health.test.js
```

Manual checks:
- `copilot-ui/VALIDATION.md` → **WS3 — Runtime Compatibility Contract (G-01-WU-03)**
- `copilot-ui/VALIDATION.md` → **WS2 — Provider SSOT + Parity Guardrails (G-02-WU-04)**
- `copilot-ui/VALIDATION.md` → **WS4 M3 — Closure Evidence Gate + DoD**
- `copilot-ui/VALIDATION.md` → **WS6 — Compatibility + Upgrade Safety Scope Gate (G-06-WU-01)**
- `copilot-ui/VALIDATION.md` → **WS6 — Release Readiness Evidence Gate (G-06-WU-04)**
