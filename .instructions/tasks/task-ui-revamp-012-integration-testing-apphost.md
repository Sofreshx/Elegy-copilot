---
schema: task/v1
id: task-000065
title: "Integration testing & AppHost verification: UI Revamp final gate"
type: chore
status: done
priority: high
owner: "dylan"
skills: ["aspire-apphost", "testing-dotnet-unit", "testing-frontend-unit", "aspire-deployment", "docs"]
depends_on: []
next_tasks: []
created: "2026-01-20"
updated: "2026-01-20"
---

## Context

This is the final verification task for the UI revamp. The goal is to ensure the full stack (AppHost, API, Workers, Web, and PostgreSQL) starts and functions correctly using Aspire AppHost, verify inter-service communication, run existing integration tests, and add any missing integration tests required by the revamp.

- AppHost entrypoint: `BetBot.AppHost/AppHost.cs`
- Services to verify: API, Workers, Web (all backed by PostgreSQL)
- This task is the final gate (HIGH priority) and should only be executed after all prerequisite tasks (T1–T11) are complete.

## Acceptance Criteria

- [ ] `dotnet run --project src/BetBot.AppHost` starts all services without errors
- [ ] PostgreSQL container(s) start and are reachable
- [ ] `GET /health` returns all checks passing (DB, dependencies)
- [ ] No startup exceptions in logs for API, Workers, Web
- [ ] Web can call API endpoints and receive valid responses
- [ ] Workers can write to and read from the DB and can read configuration
- [ ] Smoke tests for key API endpoints pass
- [ ] All UI pages render and load expected data (no console errors)
- [ ] Existing integration test suites pass
- [ ] New integration tests (listed below) added and passing
- [ ] Performance baseline acceptable (see Performance Baseline)
- [ ] README updated if startup instructions changed; new ENV vars documented

## Verification Checklist

### 1. AppHost Startup Check
- [ ] `dotnet run --project src/BetBot.AppHost` starts without errors
- [ ] PostgreSQL container starts (via Aspire/compose) and initializes
- [ ] API project starts and reports healthy
- [ ] Workers project starts and picks up expected work
- [ ] Web project starts and serves UI
- [ ] Aspire dashboard accessible and shows services running

### 2. Health Endpoint Verification
- [ ] `GET /health` returns all checks passing
- [ ] Database connection healthy/connected
- [ ] No startup exceptions in logs

### 3. Inter-Service Communication
- [ ] Web can call API endpoints (e.g., `GET /markets`)
- [ ] Workers can write to DB (seed a row and verify)
- [ ] Workers can read configuration at startup

### 4. API Endpoint Smoke Tests
- [ ] `GET /markets` - returns markets
- [ ] `GET /markets/search` - search works
- [ ] `GET /strategies` - returns strategies
- [ ] `GET /ai/sessions` - returns sessions
- [ ] `GET /trades/proposals` - returns proposals
- [ ] `GET /signals/status` - NO GroupBy error
- [ ] `GET /health` - all healthy

### 5. UI Page Smoke Tests
- [ ] `/dashboard` - loads with data
- [ ] `/polymarket` - market explorer works
- [ ] `/strategies` - list loads
- [ ] `/ai/sessions` - sessions load
- [ ] `/ai/interact` - pending items display
- [ ] `/trades` - proposals load
- [ ] `/settings` - settings display

### 6. Integration Test Suite
Run and validate:
```bash
dotnet test tests/BetBot.Tests
dotnet test tests/BetBot.Data.Integration
dotnet test tests/BetBot.Workers.Integration
```

### 7. New Integration Tests to Add
- [ ] Dashboard data aggregation test
- [ ] Polymarket → Market detail flow
- [ ] Strategy lifecycle transition test
- [ ] AI session creation → trace viewing
- [ ] Trade proposal → approval flow
- [ ] Settings persistence test (if applicable)

## Error Scenarios to Test
- [ ] API unavailable — Web shows an error page / graceful message
- [ ] Database unavailable — Health endpoint reports unhealthy
- [ ] Invalid market ID — 404 returned properly
- [ ] Unauthorized (future) — redirects or 401/403 as appropriate

## Performance Baseline
- [ ] Dashboard loads in < 2 seconds
- [ ] Market list loads in < 1 second
- [ ] No N+1 queries visible in logs

## Documentation
- [ ] Update README if startup instructions changed
- [ ] Document any new or changed environment variables
- [ ] Note any known issues and troubleshooting steps

## Plan / Approach
1. Ensure prerequisites (T1–T11) are complete and merged.
2. Start AppHost locally using Aspire (check compose or apphost docs).
3. Verify Postgres container(s) start and DB migrations run.
4. Confirm API, Workers, and Web boot successfully and check logs for exceptions.
5. Run Health endpoint and endpoint smoke tests.
6. Manually navigate UI pages and confirm data loads (use browser devtools for console errors).
7. Run existing integration tests and fix any regressions.
8. Add the new integration tests listed above as separate test files (prefer creating a dedicated `.instructions/test-tasks/` entry for the test additions).
9. Update README and docs with any changed startup steps/ENV variables.
10. Record any issues and link to follow-up tasks (bugs/perf fixes).

## Notes / Discoveries
- This task is the final verification step for the UI revamp; treat as a release gate.
- If tests reveal regressions, create focused bug tasks and link them via `depends_on`/`next_tasks`.

## Next Steps
- Execute AppHost startup check and health checks; mark checklist items as completed.
- Add focused integration test tasks under `.instructions/test-tasks/` (suggested).

---

**Suggested Adjacent Tasks:**
- Create `.instructions/test-tasks/test-0000xx--integration-dashboard-polymarket-trades.md` (Add integration tests: Dashboard, Polymarket, Trades, AI sessions)
- Create follow-up bug tasks for any regressions found during verification

**Validation:** Assign and run verification; update this task with results.
