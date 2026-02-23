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
