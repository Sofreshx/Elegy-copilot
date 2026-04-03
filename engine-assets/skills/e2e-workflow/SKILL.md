---
name: e2e-workflow
description: "E2E test workflow patterns: execution modes, evidence requirements, health endpoints, and pass/fail rules. Triggers on: e2e workflow, e2e modes, e2e evidence, e2e report format, health endpoints."
---

# E2E Workflow

## Tooling Split (Mandatory)

Instruction Engine uses two different browser-testing paths on purpose:

1. **Agent-driven browser validation**
	- Route: `@e2e-validator` -> `@e2e-browser`
	- Tool: `agent-browser` CLI
	- Use for: agent-run smoke checks, risky browser validation, auth/stateful journey confirmation, and coverage that must run during an active coding session

2. **Durable scripted browser suites**
	- Route: project or runner lane that executes Playwright CLI/test runner
	- Tool: Playwright CLI/test runner
	- Use for: repeatable regression suites, CI gates, committed browser tests, and durable scripted coverage

Do not substitute one path for the other silently.

- `@e2e-validator` and `@e2e-browser` use `agent-browser` CLI only.
- Durable scripted suites use Playwright CLI/test runner.
- Playwright MCP is not the default engine browser path.
- Keep agent-driven E2E serial through `@e2e-validator` -> `@e2e-browser`.

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

Required fields in every E2E report/result block:
- **Requirement Basis**: why E2E was required or why it was not required
- **Tool Used**: `agent-browser CLI`, `Playwright CLI/test runner`, or explicit incompatibility note
- **Coverage Performed**: what pages/flows/journeys were actually exercised
- **Gaps / Limitations**: what remained untested, blocked, or partial
- **Evidence Summary**: snapshots, console output, JS errors, screenshots, or other evidence summary
- **Status**: PASS / FAIL / INCONCLUSIVE

Detailed report fields for agent-browser runs should still include:
- **Mode**: stealth/report/live
- **Base URL**: target application URL
- **Flows table**: Flow | Steps | Status | Duration
- **Console Errors**: captured output or "None"
- **JS Exceptions**: captured output or "None"
- **Screenshots**: list of captured files (if any)
- **Failures**: detailed failure info with evidence paths

Required result-block shape for lane outputs:

```text
<E2E_VALIDATION_RESULT or E2E_BROWSER_RESULT>
- requirement_basis: <required|not-required> | <why>
- tool_used: <agent-browser CLI | Playwright CLI/test runner | explicit incompatibility note>
- coverage_performed:
	- <coverage item or NONE>
- gaps_limitations:
	- <gap or limitation or NONE>
- evidence_summary:
	- <evidence summary or NONE>
- status: PASS | FAIL | INCONCLUSIVE
```

## Pass / Fail / Inconclusive Rules

| Status | Condition |
|--------|-----------|
| PASS | All required checks pass AND browser validation actually ran |
| FAIL | Any required check fails (startup, base URL unreachable, page errors) |
| INCONCLUSIVE | Browser automation was skipped or unavailable — never mark PASS without browser |

Missing evidence artifacts → INCONCLUSIVE, not PASS.

Missing requirement basis, missing coverage performed, or missing gaps/limitations should also prevent a confident PASS report.

## Mode Selection Priority
1. Explicit input in prompt (`mode: stealth|report|live`)
2. VS Code setting (`e2e.executionMode`)
3. Repo-documented E2E policy/config (legacy `.instructions/e2e.config.md` is compatibility-only when a repo explicitly opts in)
4. Default: `report`

## Evidence Mode Selection Priority
1. Explicit input (`evidenceMode: snapshot-only|screenshots`)
2. Repo-documented E2E policy/config (legacy `.instructions/e2e.config.md` is compatibility-only when a repo explicitly opts in)
3. Default: `snapshot-only`
