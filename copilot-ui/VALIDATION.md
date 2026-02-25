# Manual Validation Guide - WU-005, WU-006, WU-007

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
Returns the content of `proposition.md` from the session directory, or 404 if it doesn't exist.

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
  "content": "## 2026-02-23T10:30:00Z — after-planning — elegy-planner\n\n### Summary\n..."
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

Both endpoints support:
- `source`: `cli` (default) or `vscode` or `all` - specifies which session home to search
- `planId`: (structured-state only) `latest` (default) or `rev-0001`, `rev-0002`, etc.

## Notes

1. **Format Version**: The parser checks for `<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->` in the plan.
2. **Warnings**: Non-fatal parse issues are returned in the `warnings` array.
3. **Defensive Parsing**: The parser never throws; returns partial data if sections are missing.
4. **Unicode Support**: Em dash (—), en dash (–), and regular dash (-) are all supported in Next Unit parsing.
5. **Checkpoint Status**: Extracted from `Notes` column using pattern `status: passed|failed|pending|skipped`.

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
- [ ] `GET /proposition` returns content when file exists
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
- [ ] `session-source.js` loaded before `app.js` (check Elements/Sources tab)

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

## WS6 — Desktop Signing Trust Chain (G-02-WU-04)

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
