---
name: e2e-workflow
description: "E2E test workflow patterns: execution modes, evidence requirements, health endpoints, and pass/fail rules. Triggers on: e2e workflow, e2e modes, e2e evidence, e2e report format, health endpoints."
---

# E2E Workflow

## Execution Modes

| Mode | Speed | Visibility | Evidence |
|------|-------|------------|----------|
| stealth | Maximum | None | Error screenshots only |
| report | Fast | Async artifacts | Snapshots + console + errors (screenshots optional) |
| live | Deliberate | Real-time | Everything + visible browser window |

Default mode: `report`. Default evidence mode: `snapshot-only`.

## Evidence Requirements (Mandatory)

Every E2E run must produce:
1. **Snapshots** at each major step (page state capture)
2. **Console output** at test end
3. **JS errors** at test end
4. **Summary report** written to output directory

Screenshots are only required when evidence mode is `screenshots` or on failure.

## Screenshot Naming Convention
Format: `<flow>-step-<N>-<action>.png`
Examples: `login-step-01-navigate.png`, `login-step-02-fill-email.png`

## Evidence Modes
- `snapshot-only` (default): page state snapshots, console, errors — no screenshots unless failure
- `screenshots`: full screenshot capture at every major step in addition to snapshots

## Health Endpoint Table

| Endpoint | Expected | Required |
|----------|----------|----------|
| `/health` | 200 OK | No |
| `/api/health` | 200 OK | No |
| `/ready` | 200 OK | No |
| `/healthz` | 200 OK | No |
| `/` (base URL) | 200 OK | Yes |

At least one health endpoint OR the base URL must respond for validation to proceed.

## Report Format

Required fields in the E2E report:
- **Mode**: stealth/report/live
- **Base URL**: target application URL
- **Status**: PASS / FAIL / INCONCLUSIVE
- **Flows table**: Flow | Steps | Status | Duration
- **Console Errors**: captured output or "None"
- **JS Exceptions**: captured output or "None"
- **Screenshots**: list of captured files (if any)
- **Failures**: detailed failure info with evidence paths

## Pass / Fail / Inconclusive Rules

| Status | Condition |
|--------|-----------|
| PASS | All required checks pass AND browser validation actually ran |
| FAIL | Any required check fails (startup, base URL unreachable, page errors) |
| INCONCLUSIVE | Browser automation was skipped or unavailable — never mark PASS without browser |

Missing evidence artifacts → INCONCLUSIVE, not PASS.

## Mode Selection Priority
1. Explicit input in prompt (`mode: stealth|report|live`)
2. VS Code setting (`e2e.executionMode`)
3. Project config (`.instructions/e2e.config.md`)
4. Default: `report`

## Evidence Mode Selection Priority
1. Explicit input (`evidenceMode: snapshot-only|screenshots`)
2. Project config (`.instructions/e2e.config.md`)
3. Default: `snapshot-only`
