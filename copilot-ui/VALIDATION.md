# Manual Validation Guide - WU-005, WU-006, WU-007

This file is a narrow manual companion for selected session-artifact endpoints.
Use `docs/system/copilot-ui-guide.md` as the canonical overview for the current `copilot-ui`
runtime surface, tabs, route groups, persistence model, and validation anchors.

## Overview
This document provides curl commands to manually validate the new Plan-Pack Progress Tracker endpoints.

## Prerequisites
1. Server must be running: `node copilot-ui/server.js`
2. Use a valid session ID (example: `a04980e8-4804-411d-a774-0a4cbf88576e`)

## Endpoint 1: GET /api/sessions/:id/structured-state

### Description
Returns structured JSON parsed from the Plan-Pack Progress Tracker section of plan.md.

### Basic Test (latest plan)
```bash
curl "http://127.0.0.1:3210/api/sessions/a04980e8-4804-411d-a774-0a4cbf88576e/structured-state?source=cli&planId=latest"
```

### Expected Response (200 OK)
```json
{
  "id": "a04980e8-4804-411d-a774-0a4cbf88576e",
  "source": "cli",
  "planId": "latest",
  "formatVersion": 1,
  "warnings": [],
  "groups": [
    {
      "group": "G-01",
      "title": "Artifact contract + Elegy migration",
      "status": "not-started",
      "wusDone": 0,
      "wusTotal": 4,
      "dependsOn": null
    }
    // ... more groups
  ],
  "workUnits": [
    {
      "group": "G-01",
      "workUnitId": "WU-001",
      "status": "not-started",
      "nextUnit": "WU-002",
      "notes": "Document artifact contract"
    }
    // ... more work units
  ],
  "checkpoints": [
    {
      "group": "G-01",
      "checkpoint": "manual-review",
      "trigger": "After G-01",
      "notes": "Confirm no `.instructions/sessions` remains",
      "status": "pending"
    }
    // ... more checkpoints
  ],
  "nextUnit": {
    "workUnitId": "WU-001",
    "rationale": "Define the canonical artifact contract first; all parsing and agent migrations depend on it."
  },
  "meta": {}
}
```

### Test with Specific Revision
```bash
curl "http://127.0.0.1:3210/api/sessions/SESSION_ID/structured-state?source=cli&planId=rev-0001"
```

### Test 404 (Missing Session)
```bash
curl "http://127.0.0.1:3210/api/sessions/nonexistent-session/structured-state?source=cli"
```

Expected: `{"error":"Session not found","id":"nonexistent-session","source":"cli"}`

### Test 404 (Missing Plan)
```bash
curl "http://127.0.0.1:3210/api/sessions/SESSION_ID/structured-state?source=cli&planId=nonexistent"
```

Expected: `{"error":"Plan artifact not found","id":"...","source":"cli","planId":"nonexistent"}`

## Endpoint 2: GET /api/sessions/:id/proposition

### Description
Returns the content of `proposition.md` from the session directory, plus parsed closeout entries when the artifact follows the structured proposition format.

### Basic Test
```bash
curl "http://127.0.0.1:3210/api/sessions/a04980e8-4804-411d-a774-0a4cbf88576e/proposition?source=cli"
```

### Expected Response (v1: 404 if file not present)
```json
{
  "error": "Proposition not found",
  "id": "a04980e8-4804-411d-a774-0a4cbf88576e",
  "source": "cli"
}
```

### Expected Response (200 if file exists)
```json
{
  "id": "a04980e8-4804-411d-a774-0a4cbf88576e",
  "source": "cli",
  "content": "## 2026-02-23T10:30:00Z — after-planning — elegy-planner\n\n### Summary\n...",
  "entries": [
    {
      "occurredAt": "2026-02-23T10:30:00Z",
      "phase": "after-planning",
      "agent": "elegy-planner",
      "sections": [
        {
          "key": "summary",
          "title": "Summary",
          "content": "...",
          "bullets": []
        }
      ]
    }
  ],
  "latestEntry": {
    "occurredAt": "2026-02-23T10:30:00Z",
    "phase": "after-planning",
    "agent": "elegy-planner"
  }
}
```

## Endpoint 3: GET /api/sessions/:id/handoff

### Description
Returns the content of `handoff.md` from the session directory, plus parsed manifest fields, required sections, and parser warnings.

### Basic Test
```bash
curl "http://127.0.0.1:3210/api/sessions/a04980e8-4804-411d-a774-0a4cbf88576e/handoff?source=cli"
```

### Expected Response (v1: 404 if file not present)
```json
{
  "error": "Handoff not found",
  "id": "a04980e8-4804-411d-a774-0a4cbf88576e",
  "source": "cli"
}
```

### Expected Response (200 if file exists)
```json
{
  "id": "a04980e8-4804-411d-a774-0a4cbf88576e",
  "source": "cli",
  "content": "## Handoff Manifest\n- Session: a04980e8-4804-411d-a774-0a4cbf88576e\n...",
  "parsed": {
    "manifest": {
      "session": "a04980e8-4804-411d-a774-0a4cbf88576e",
      "plan": "plan.md",
      "planStatus": "APPROVED",
      "reviewer": "Verdict: APPROVED"
    },
    "sections": [
      {
        "key": "immediateNextActions",
        "title": "Immediate Next Actions",
        "content": "- Execute WU-001.",
        "bullets": ["Execute WU-001."]
      }
    ],
    "warnings": []
  }
}
```

## Platform-Specific Commands

### Windows PowerShell (Pretty Print)
```powershell
curl.exe "http://127.0.0.1:3210/api/sessions/SESSION_ID/structured-state?source=cli" | ConvertFrom-Json | ConvertTo-Json -Depth 10
```

### Unix/Linux/Mac (Pretty Print with jq)
```bash
curl -s "http://127.0.0.1:3210/api/sessions/SESSION_ID/structured-state?source=cli" | jq '.'
```

## Query Parameters

All endpoints support:
- `source`: `cli` (default) or `vscode` or `all` - specifies which session home to search
- `planId`: (structured-state only) `latest` (default) or `rev-0001`, `rev-0002`, etc.

## Notes

1. **Format Version**: The parser checks for `<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->` in the plan.
2. **Warnings**: Non-fatal parse issues are returned in the `warnings` array.
3. **Defensive Parsing**: The parser never throws; returns partial data if sections are missing.
4. **Unicode Support**: Em dash (—), en dash (–), and regular dash (-) are all supported in Next Unit parsing.
5. **Checkpoint Status**: Extracted from `Notes` column using pattern `status: passed|failed|pending|skipped`.
6. **Resume Readiness**: `structured-state` now emits `meta.reviewLedger`, optional `meta.handoff`, and `meta.resume` so clients can determine whether a session is safe to resume.

## Validation Checklist

- [ ] `GET /structured-state` with valid session returns 200
- [ ] Response includes all expected fields (groups, workUnits, checkpoints, nextUnit)
- [ ] Groups array has correct count and structure
- [ ] Work Units array has correct count and structure
- [ ] Checkpoints array parsed correctly with status
- [ ] Next Unit parsed correctly (workUnitId + rationale)
- [ ] Format version detected (1 if marker present, 0 otherwise)
- [ ] Warnings array present (empty if no issues)
- [ ] `GET /proposition` returns 404 when file missing
- [ ] `GET /proposition` returns content plus parsed entries when file exists
- [ ] `GET /handoff` returns 404 when file missing
- [ ] `GET /handoff` returns parsed manifest and required sections when file exists
- [ ] Both endpoints handle invalid session ID (404)
- [ ] Endpoints work with `source=cli` and `source=vscode`

## Auth Gate Validation

### Prerequisites
- Server running with `node copilot-ui/server.js`

### Test Scenarios

#### 1. Loopback without auth (backward-compatible)
```bash
curl http://127.0.0.1:3210/api/health
```
Expected: 200 OK with health JSON

#### 2. Non-loopback with auto-generated token
```bash
node copilot-ui/server.js --host 0.0.0.0
# Note the auth token printed at startup
curl -H "Authorization: Bearer <token>" http://localhost:3210/api/health
```
Expected: 200 OK with health JSON

#### 3. Non-loopback without token
```bash
curl http://<non-loopback-ip>:3210/api/health
```
Expected: 401 empty body

#### 4. Non-loopback with wrong token
```bash
curl -H "Authorization: Bearer wrong-token" http://<non-loopback-ip>:3210/api/health
```
Expected: 401 empty body

#### 5. Non-loopback with Basic auth (should fail)
```bash
curl -H "Authorization: Basic dXNlcjpwYXNz" http://<non-loopback-ip>:3210/api/health
```
Expected: 401 empty body (only Bearer is accepted)

#### 6. Query-string token attempt (should fail)
```bash
curl "http://<non-loopback-ip>:3210/api/health?token=<token>"
```
Expected: 401 empty body (query-param auth not supported)

### Scope Notes
- Auth is single-session scope only
- Multi-session aggregate views are deferred
- Token auto-generated for non-loopback binds; `--token` or `COPILOT_UI_TOKEN` env var for explicit control

---

## WS2 — UI Source Handling Alignment (WU-201 through WU-206)

### Prerequisites
1. Server running: `node copilot-ui/server.js`
2. Open `http://127.0.0.1:3210` in a browser
3. Have at least one CLI session and one VS Code session on disk

### 1. Filter Cycle Test
1. Default view: **All** tab is active, both CLI and VS Code sessions visible.
2. Click **CLI** → only sessions with `source=cli` or `canonicalSource=cli` appear.
3. Click **VS Code** → only VS Code-sourced sessions appear.
4. Click **Sandbox** → only sandbox-sourced sessions appear (may be empty).
5. Click **All** → all sessions return.
6. Each click changes the active tab highlight correctly (only one active at a time).

### 2. No Duplicate Rows
- In **All** view with `dedupe=on` (default), each canonical session appears exactly once.
- Open browser console — no `[session-dedupe] Duplicate canonicalKey detected` warnings.
- If duplicates somehow appear, the warning is logged and only the first occurrence is kept.

### 3. Action Routing Uses Resolved Source
- Select a merged `[MULTI]` session in All view.
- Click **Archive session** → confirm dialog shows the resolved `canonicalSource` (not `all`).
- The archive API call uses the resolved source in `?source=` param (verify in Network tab).
- Repeat for **Delete permanently** — same resolved source in the API call.
- Select a single-source session → archive/delete use that session's `source` or `canonicalSource`.

### 4. [MULTI] Badge Behavior
- In **All** view: sessions merged from multiple sources show `[MULTI]` prefix.
- In **All** view: single-source sessions show `[CLI]`, `[VSCODE]`, or `[SANDBOX]` prefix.
- In **CLI** / **VS Code** / **Sandbox** views: no source badge is shown (prefix is empty).

### 5. ACP-Only Rows
- If the ACP tracker reports a session that has no filesystem counterpart, it appears with `[ACP-ONLY]` badge.
- ACP-only rows have a visually muted appearance (`acp-only-muted` class).
- ACP-only rows are still clickable and display session detail.

### 6. Session Detail Source Display
- Select any session → Session Detail panel shows **Source:** with the correct resolved source.
- Plans, events, final output, and structured state all load using the resolved source.

### Validation Checklist
- [ ] Filter cycle: All → CLI → VS Code → Sandbox → All works correctly
- [ ] No duplicate rows in any filter view
- [ ] Archive action uses `resolveSessionSource()` (check Network tab)
- [ ] Delete action uses `resolveSessionSource()` (check Network tab)
- [ ] `[MULTI]` badge appears only in All view for multi-source sessions
- [ ] Source badges hidden when a specific filter is active
- [ ] ACP-only rows appear with muted styling
- [ ] Console has no `[session-dedupe]` warnings under normal operation
- [ ] React bundle is served from `ui-dist` (legacy `public/app.js` no longer loaded)

## WS3 — Runtime Compatibility Contract (G-01-WU-03)

### Purpose
Verify deterministic runtime contract behavior for repo vs packaged mode and capability fallback states (Docker, WSL2, sandbox).

### 1) Default mode check (repo fallback)
```bash
node copilot-ui/server.js --host 127.0.0.1 --port 3210
curl http://127.0.0.1:3210/api/health
```

Expected in response JSON:
- `runtime.contractVersion` is present
- `runtime.mode` is `repo` unless overridden
- `runtime.capabilities` includes `docker`, `wsl2`, `sandbox`

### 2) Forced packaged + unavailable matrix
```bash
INSTRUCTION_ENGINE_RUNTIME_MODE=packaged \
INSTRUCTION_ENGINE_FORCE_DOCKER_STATE=unavailable \
INSTRUCTION_ENGINE_FORCE_WSL2_STATE=unavailable \
INSTRUCTION_ENGINE_FORCE_SANDBOX_STATE=unavailable \
node copilot-ui/server.js --host 127.0.0.1 --port 3210

curl http://127.0.0.1:3210/api/health
```

Expected in response JSON:
- `runtime.mode` is `packaged`
- `runtime.capabilities.docker` is `unavailable`
- `runtime.capabilities.wsl2` is `unavailable`
- `runtime.capabilities.sandbox` is `unavailable`

### 3) Stable payload contract assertions
For repeated calls to `GET /api/health`, assert:
- top-level keys still include `ok`, `now`, `engineRoot`, `copilotHome`, `vscodeHome`, `changes`, `runtime`
- `runtime` object shape remains stable: `contractVersion`, `mode`, `capabilities`
- no missing capability keys even when unavailable (`docker`, `wsl2`, `sandbox` always present)

### G-01-WU-04 Contract Regression Gate Commands

Run these from repository root (`instruction-engine`) to validate the frozen contracts from G-01 WU-01..WU-03:

```bash
node copilot-ui/lib/runtimeContracts.test.js
node copilot-ui/server.runtime-health.test.js
node copilot-ui/server.lifecycle-proxy.test.js
npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/lifecycleOperations.test.ts src/messagingGateway/__tests__/gatewayHttpServer.test.ts
```

Expected gate result:
- each command exits with code `0`
- no failed assertions in runtime/provider/planning health envelope tests
- lifecycle create/open-terminal contract assertions pass for both `copilot-ui` and `local-tracker`

## WS2 — Provider SSOT + Parity Guardrails (G-02-WU-04)

Run this narrow gate from repository root (`instruction-engine`) whenever validating WS2 provider-state/parity scope:

```bash
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/lib/planningApiContracts.test.js
node copilot-ui/server.runtime-health.test.js
```

WS2 guardrails verified by this gate:
- non-Docker default remains canonical when selection is absent/invalid
- provider selection SSOT remains deterministic when canonical persisted provider state exists
- unsupported capability paths remain capability-gated with deterministic marker envelopes
- finish compatibility hook remains additive contract-only (`scopeBoundary=ws2_contract_hook_only`, `ws4Ownership=finish_behavior_and_ux`)
- WS6 compatibility/release-safety checks must not redefine WS2-owned primary non-Docker default behavior

Expected narrow gate result:
- each command exits with code `0`
- all assertions pass with no WS4 UX behavior fields introduced in WS2 capability responses

## WS6 — Compatibility + Upgrade Safety Scope Gate (G-06-WU-01)

### Scope + sequencing lock

- WS6 starts only after WS1 contract freeze is complete (`G-01-WU-04`).
- WS2 remains owner of primary non-Docker default behavior.
- WS6 non-Docker scope is compatibility/upgrade safety only (mixed-version safeguards, rollback controls, release-safety gating).

### Manual checks

1. Confirm [docs/system/runtime-permissions-contracts.md](../docs/system/runtime-permissions-contracts.md) includes:
  - explicit post-WS1 sequencing gate for WS6
  - explicit WS2 vs WS6 non-Docker ownership boundary
2. Confirm [README.md](../README.md) includes the same WS6 sequencing + ownership lock language.
3. Run docs graph validation:

```bash
node scripts/validate-doc-graph.js
```

Expected gate result:
- command exits with code `0`
- no WS6 guidance reassigns non-Docker primary default ownership away from WS2

## WS6 — Release Readiness Evidence Gate (G-06-WU-04)

### Required command pack

Run this command pack from repository root (`instruction-engine`) and retain outputs as release evidence:

```bash
node scripts/validate-doc-graph.js
node copilot-ui/server.lifecycle-proxy.test.js
npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/gatewayHttpServer.test.ts
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/server.runtime-health.test.js
node copilot-ui/dist-electron/rollbackPolicy.test.js
node copilot-ui/dist-electron/updatePolicy.rollback.test.js
node copilot-ui/dist-electron/updater.rollback.test.js
```

### Gate checklist (all required)

| Gate item | Required evidence artifact | Pass expectation | Fail expectation |
|---|---|---|---|
| Scope + ownership lock | `WS6-E1 ScopeOwnership`: links or excerpts proving WS6 sequencing and WS2 ownership boundary in `docs/system/runtime-permissions-contracts.md` and `README.md` | Both docs explicitly keep WS6 as post-WS1 compatibility/release-safety scope only; WS2 remains owner of primary non-Docker default behavior | Missing/contradictory scope language, or any text that reassigns WS2 ownership |
| Mixed-version matrix | `WS6-E2 MixedVersionMatrix`: command outputs from `server.lifecycle-proxy.test.js` and `gatewayHttpServer.test.ts` | Outputs include deterministic unsupported marker path (`code=lifecycle_compatibility_unsupported`) and deterministic supported path (`reason=compatibility_supported`) for old/new client-tracker directions | Missing unsupported or supported path evidence, nondeterministic reasons/markers, or any failing test |
| Checksum safety | `WS6-E3 ChecksumSafety`: output from `planningPersistence.test.js` and `server.runtime-health.test.js` | Migration checksum path proves `pass`/`all_manifest_checksums_match`; drift path hard-fails with `PLANNING_MIGRATION_CHECKSUM_DRIFT`; health payload keeps deterministic `planningPersistence.migrations.driftDetected` state | Checksum drift does not fail closed, pass path missing, or migration drift state not deterministic |
| Rollback trigger thresholds | `WS6-E4 RollbackTriggers`: output from `rollbackPolicy.test.js` and `updatePolicy.rollback.test.js` | Outputs include machine-readable reasons for threshold triggers (`rollback_policy_source_unavailable`, `rollback_policy_malformed`, `current_version_below_minimum_safe`, `candidate_version_above_channel_ceiling`) and allowed path marker (`allowed_by_rollback_policy`) | Any trigger reason missing/changed, or trigger behavior not fail-closed |
| Kill-switch activation evidence | `WS6-E5 KillSwitch`: output from `updater.rollback.test.js` plus ops approval note referencing release authority | Output includes `updates_disabled_globally` blocking update checks; release record confirms Release Engineering execution with incident commander approval and Security co-approval for trust-chain incidents | Kill-switch does not block checks, missing `updates_disabled_globally` evidence, or missing required ownership/approval record |

### Gate decision

- WS6 release readiness is **pass** only when all five artifacts (`WS6-E1`..`WS6-E5`) are present and all command results exit `0`.
- WS6 release readiness is **fail** when any artifact is missing, any required marker/reason is absent, or any command fails.
- A failed WS6 gate blocks release progression until corrected evidence is regenerated.

## WS6 — CI Topology + Trigger Coverage + Required Checks (WU-WS6-01 / WU-WS6-03 / WU-WS6-04 / WU-WS6-05)

Authoritative workflow: `.github/workflows/extension-ci.yml`.

### Fixed topology (must remain fail-closed)

- `build`
- `ws6-evidence` matrix (`WS6-E1`..`WS6-E5`)
- `ws6-artifact-gate`
- `required-checks`
- `release` (tag-only; depends on `build` + `required-checks`)

### Trigger coverage checks

For pull requests, confirm workflow path filters include WS6-owned files:

- `.github/workflows/extension-ci.yml`
- `copilot-ui/VALIDATION.md`
- `docs/system/runtime-permissions-contracts.md`
- `README.md`
- `scripts/validate-planpack.js`
- `scripts/validate-planpack.evidence.test.js`
- `scripts/validate-planpack.final-gate.test.js`
- `docs/system/session-state-artifacts.md`
- `docs/system/planpack-spec.md`

### Matrix evidence + artifact gate checks

1. `ws6-evidence` runs all five matrix IDs (`WS6-E1`..`WS6-E5`) and uploads one artifact per ID.
2. Each artifact contains:
  - `command.log`
  - `metadata.json`
  - `command.log.sha256`
  - `metadata.json.sha256`
3. `ws6-artifact-gate` fails closed on:
  - missing or extra WS6 artifacts,
  - missing required files,
  - checksum mismatch,
  - evidence-ID mismatch in `metadata.json`.

### Required-check aggregator semantics

`required-checks` must fail unless all are true:

- `needs.build.result == success`
- `needs.ws6-evidence.result == success`
- `needs.ws6-artifact-gate.result == success`
- `needs.ws6-artifact-gate.outputs.complete == true`

Missing/skipped/non-success statuses are treated as release-blocking failures.

## WS6 — Narrow-to-Broad Validation + Rollback Contract (WU-WS6-07)

Run validation in this order:

1. Narrow static checks

```bash
node scripts/validate-manifest.js
node scripts/validate-doc-graph.js
```

2. Compatibility + checksum checks

```bash
node copilot-ui/server.lifecycle-proxy.test.js
npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/gatewayHttpServer.test.ts
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/server.runtime-health.test.js
```

3. Broad rollback + kill-switch checks

```bash
node copilot-ui/dist-electron/rollbackPolicy.test.js
node copilot-ui/dist-electron/updatePolicy.rollback.test.js
node copilot-ui/dist-electron/updater.rollback.test.js
```

Contract result:
- **Pass**: all stages pass and WS6 artifacts are complete/integrity-verified.
- **Fail**: any stage fails, required artifact/check is missing, or `required-checks` is non-success.

## WS4 — Electron Packaging Baseline (G-02-WU-02)

### Build baseline

```bash
cd copilot-ui
npm install
npm run build:electron
```

Expected:
- `dist-electron/main.js` and `dist-electron/preload.js` are generated.

### Desktop preview package smoke

```bash
cd copilot-ui
npm run package:preview
```

Expected:
- unpacked app artifact is generated under `copilot-ui/release/`.
- launched app opens dashboard UI backed by the same local API behavior.

### Windows package smoke

```bash
cd copilot-ui
npm run package:win
```

Expected:
- Windows installer artifact appears under `copilot-ui/release/`.
- app launches and renders the same dashboard tabs/content as `node copilot-ui/server.js`.

## WS5 — Update Channel Isolation (G-02-WU-03)

### Policy behavior

- Stable channel must not accept prerelease candidates.
- Prerelease channel may accept prerelease candidates.

### Manual checks

1. Launch desktop app with `INSTRUCTION_ENGINE_UPDATE_CHANNEL=stable` and app version without prerelease suffix.
  - Verify logs include blocked reason when prerelease update candidate is discovered.
2. Launch desktop app with `INSTRUCTION_ENGINE_UPDATE_CHANNEL=prerelease`.
  - Verify prerelease update candidates are not blocked by channel policy.
3. Launch without explicit channel override.
  - Channel resolves from app version (`x.y.z` => stable, `x.y.z-...` => prerelease).

## WS5A — Rollback + Kill Switch Controls (G-02-WU-05)

### Policy behavior

- Rollback policy source is fail-closed (`rollback_policy_source_unavailable` / `rollback_policy_malformed`).
- Global kill switch blocks update checks and candidates (`updates_disabled_globally`).
- Minimum-safe thresholds block unsafe current/candidate versions.
- Channel version ceilings block candidates above rollback target ceiling.

### Game-day scenarios

1. Kill switch enabled:
  - Set `INSTRUCTION_ENGINE_DISABLE_UPDATES=true`.
  - Expected logs include `updates_disabled_globally` and no update check request is sent.

2. Policy source unavailable:
  - Unset `INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON` and set `INSTRUCTION_ENGINE_DISABLE_UPDATES=false`.
  - Expected logs include `rollback_policy_source_unavailable` and checks are blocked.

3. Policy malformed:
  - Set `INSTRUCTION_ENGINE_ROLLBACK_POLICY_JSON={"updatesEnabled":"bad"}`.
  - Expected logs include `rollback_policy_malformed` and checks are blocked.

4. Minimum-safe threshold:
  - Set policy `minimumSafeVersion` higher than current app version.
  - Expected blocked reason: `current_version_below_minimum_safe`.

5. Channel ceiling rollback:
  - Set policy `channelVersionCeilings.stable` below discovered stable candidate.
  - Expected blocked reason: `candidate_version_above_channel_ceiling`.

## WS6A — Desktop Signing Trust Chain (Release Safety Stream)

### CI release gate expectations

- Workflow: `.github/workflows/desktop-release.yml`
- Trigger with a desktop tag (`desktop-vx.y.z` or `desktop-vx.y.z-rc.1`) or manual dispatch with `release_tag`.

### Required repo configuration

- Variable: `DESKTOP_SIGNING_SERVICE_URL` (required, fail closed if absent)
- Variable: `DESKTOP_SIGNING_SERVICE_AUDIENCE` (optional)
- Secret: `DESKTOP_SIGNING_SERVICE_API_KEY` (optional)

### Manual checks

1. Run workflow without `DESKTOP_SIGNING_SERVICE_URL` configured.
  - Expected: workflow fails at signing contract with a clear fail-closed message.
2. Run workflow with signing endpoint configured and valid service response.
  - Expected: Windows signed installer + `signature-manifest.json` + `provenance.attestation.json` are required before draft release.
3. Confirm Linux metadata signature verification step passes.
  - Expected: `linux-preview-metadata.sha256` is verified against service-issued signature/certificate before publish.
4. Confirm macOS preview label is present.
  - Expected: `MAC_PREVIEW_UNSIGNED.txt` exists and release still stays draft.
5. Confirm prerelease inference.
  - `desktop-v1.2.3` => draft stable release (`prerelease: false`)
  - `desktop-v1.2.3-rc.1` => draft prerelease (`prerelease: true`)
6. Confirm attestation mismatch blocks release.
  - In a non-production test run, tamper either `artifacts/windows/windows-signed-installer.exe` or `artifacts/windows/provenance.attestation.json` before publish.
  - Expected: publish gate fails with a provenance mismatch/malformed attestation error and `Publish desktop draft release` does not execute.

## G-03 — Reconciliation Invariants Checkpoint (G-03-WU-05)

Run this checkpoint from repository root (`instruction-engine`) whenever validating state authority/reconciliation hardening:

```bash
node copilot-ui/lib/sessionAggregation.test.js
node copilot-ui/lib/runtimeContracts.test.js
node copilot-ui/lib/planningApiContracts.test.js
node copilot-ui/server.lifecycle-proxy.test.js
node copilot-ui/server.runtime-health.test.js
```

Expected checkpoint result:
- each command exits with code `0`
- authority precedence remains deterministic (`runtime > artifact`, with explicit `acp|acp-only|fs` authority outcomes)
- stale/conflict downgrade markers and reason-code arrays are deterministic (sorted + deduped across equivalent inputs)
- recovery-visible outputs remain explicit and deterministic (`recovery_checkpoint_only|recovery_ledger_only|recovery_missing_both`)
- sessions API merged view exposes reconciliation metadata (`authority`, `sourceOfTruth`, `sourcePrecedence`, `sourceSet`)

## G-04 — Finish Proxy Parity + Canonical Sandbox ID Invariant Checkpoint (G-04-WU-04)

Run this checkpoint from repository root (`instruction-engine`) whenever validating cross-WS finish proxy behavior and canonical sandbox ID invariants:

```bash
node copilot-ui/server.lifecycle-proxy.test.js
npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/lifecycleOperations.test.ts src/messagingGateway/__tests__/gatewayHttpServer.test.ts
```

Expected checkpoint result:
- each command exits with code `0`
- finish proxy payload parity is enforced for both finish branches (`skip-pr` and `open-pr`)
- canonical edited sandbox IDs remain stable across finish responses (`result.sandboxId` and `result.close.result.sandboxId`)
- invariant violations fail deterministically with HTTP `409`, `code=canonical_sandbox_id_invariant_violation`, and `invariant.marker=conflict`
- provider-state migration metadata is surfaced as deterministic context only and cannot rewrite persisted canonical sandbox IDs

## G-05 — WS3 Authority Dependency Gate Checkpoint (G-05-WU-01)

Run this checkpoint from repository root (`instruction-engine`) whenever validating planning durability dependency gating behavior:

```bash
node copilot-ui/server.lifecycle-proxy.test.js
node copilot-ui/server.runtime-health.test.js
```

Expected checkpoint result:
- each command exits with code `0`
- WS3 authority dependency gate reports deterministic readiness metadata in `GET /api/health` (`planningDurabilityDependencyGate`)
- when gate readiness is not satisfied, planning durability routes fail closed with HTTP `503`, `code=planning_durability_dependency_gate_blocked`, and `dependencyGate.marker=dependency-blocked`
- non-durability routes (for example `GET /api/sessions`) remain backward compatible and continue to succeed while the durability gate is blocked

## WS5A M1 — Mandatory Durability Hardening (WU-WS5A-M1-01 / WU-WS5A-M1-02)

Run this WS5A M1 checkpoint from repository root (`instruction-engine`):

```bash
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/server.runtime-health.test.js
```

Optional interaction regression check when touching merge lifecycle paths:

```bash
node copilot-ui/server.lifecycle-proxy.test.js
```

Expected WS5A M1 outcomes:
- additive migration manifest includes durability artifact versions for compare receipts, merge intents, merge idempotency ledger, suggestions, and recaps
- compare/merge-intent/merge routes fail closed with HTTP `503`, `code=planning_durability_route_gate_blocked`, and explicit deterministic `reason`
- route-gate failure envelope includes `durabilityRouteGate.reasonCodes` and migration readiness metadata (`migrationVersions`, `checkedMigrationVersions`, `missingMigrationVersions`)
- non-durability routes remain backward compatible while the WS5A durability route gate is blocking

## WS5A M3 — Durable Suggestions + Recaps Contract Closure

Run this WS5A M3 checkpoint from repository root (`instruction-engine`):

```bash
node copilot-ui/server.lifecycle-proxy.test.js
node copilot-ui/server.runtime-health.test.js
node copilot-ui/lib/planningPersistence.test.js
```

Expected WS5A M3 outcomes:
- suggestion and recap artifacts persist durably and are restart-safe (retrieval succeeds after restart-style rehydration)
- retrieval contracts are explicit and deterministic (`GET /api/planning/suggestions?suggestionId=<id>`, `GET /api/planning/recaps?recapId=<id>`)
- missing IDs return deterministic `400`; missing artifacts return deterministic `404`; ownership mismatches return deterministic `403`
- WS5A durability gate continues to fail closed for suggestions/recaps when persistence authority is unavailable, with canonical reason code (`planning_persistence_not_configured|planning_persistence_migration_error`)
- health/evidence closure remains additive and does not relax existing WS5A route-gate requirements

## G-05 — Crash Write-Through + Restart Durability Pack (G-05-WU-05)

Run this narrow durability pack from repository root (`instruction-engine`) to validate crash/restart persistence behavior and deterministic recovery markers:

```bash
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/lib/planningApiContracts.test.js
node copilot-ui/server.lifecycle-proxy.test.js
```

Expected durability outcomes:
- `planningPersistence.test.js` proves write-through crash modes are explicit: pre-write crash leaves no persisted row; post-write crash is recoverable by persisted read-back after restart simulation.
- `planningApiContracts.test.js` proves projection hydration after crash never assumes silent partial writes: non-durable in-memory records are dropped, and restart state converges to persisted authority.
- `server.lifecycle-proxy.test.js` proves restart recovery markers are deterministic for checkpoint-only, ledger-only, and reconciled states.

Reproducible sequence (single pass):
1. Run all three commands in order as shown above.
2. Confirm each command exits `0`.
3. Verify output includes PASS lines for the new durability scenarios:
  - `write-through crash before DB mutation fails without silent partial write assumptions`
  - `write-through crash after DB mutation is restart-recoverable via persisted authority read-back`
  - `projection hydration after crash drops non-durable in-memory records and restores deterministically on restart`
  - `deriveBackfillRecoveryMarker models crash write-through and restart recovery sequence deterministically`

## WS4 M2 — Retention / Export-Import / Corruption Recovery

Run the WS4 M2 checkpoint pack from repository root (`instruction-engine`):

```bash
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/server.runtime-health.test.js
```

Optional shared-contract regression check:

```bash
node copilot-ui/lib/planningApiContracts.test.js
```

Expected WS4 M2 outcomes:
- retention supports deterministic `dry-run` and `execute` modes with explicit report envelopes
- export/import contract is additive and deterministic, with repeated import producing idempotent replay counts
- corruption scans return deterministic markers and write paths fail closed with explicit code/reason when recovery is required
- durability routes continue to fail closed when persistence authority is configured but not ready

## WS4 M3 — Closure Evidence Gate + DoD

Run this closure pack from repository root (`instruction-engine`):

```bash
node copilot-ui/lib/planningPersistence.test.js
node copilot-ui/lib/planningApiContracts.test.js
node copilot-ui/server.runtime-health.test.js
npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/lifecycleOperations.test.ts src/messagingGateway/__tests__/gatewayHttpServer.test.ts
```

Required DoD markers:
- planning persistence suite proves deterministic/fail-closed retention, import replay, checksum baseline, and corruption scan envelopes
- planning API contract suite proves deterministic idempotency conflict semantics (`idempotency_conflict`, `idempotency_key_payload_mismatch`)
- runtime health suite proves deterministic gateway state/connect envelopes with tracker-compatible config path semantics
- local-tracker lifecycle/gateway suites prove canonical sandbox ID retry invariants and deterministic idempotency conflict handling

WS4 freeze decision:
- **Pass**: all four commands exit `0` and required markers are present.
- **Fail**: any command fails, a required marker is missing/changed, or path/idempotency semantics drift.

## WS-05 - Sandbox Token Gating Invariants

### Invariant mapping

| Invariant | Test file | Case ID/title |
|---|---|---|
| WS05-I1 strict predicate truth table | `copilot-ui/lib/sandboxLifecycleTokenContract.test.js` | `WS05-I1 isKnownMissingTokenIndicator strict predicate truth table` |
| WS05-I2 local pre-proxy guard -> proxy count 0 | `copilot-ui/routes/tracker.test.js` | `WS05-I2 local pre-proxy guard short-circuits with canonical envelope and proxy count 0` |
| WS05-I3 token-present path -> proxy count 1, no remap | `copilot-ui/routes/tracker.test.js` | `WS05-I3 token-present path proxies once without local remap` |
| WS05-I4 unrelated failures pass through with status/body/selected headers parity | `copilot-ui/server.lifecycle-proxy.test.js` | `WS05-I4 buildTrackerProxyResponsePlan passes unrelated failures through with status/body/selected headers parity` |
| WS05-I5 TabShell/Panel selector contract present in app.css and component refs | `copilot-ui/tests/ui-react-smoke.test.js` | `WS05-I5 TabShell/Panel selector contract is present in app.css and component refs` |

### WS-05 validation command pack

Run from repository root (`instruction-engine`):

```bash
node copilot-ui/lib/sandboxLifecycleTokenContract.test.js
node copilot-ui/server.lifecycle-proxy.test.js
node copilot-ui/server.runtime-health.test.js
node copilot-ui/routes/tracker.test.js
node copilot-ui/tests/ui-react-smoke.test.js
node copilot-ui/tests/sandbox-token-contract-literals.test.js
```
