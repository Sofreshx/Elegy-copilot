---
schema: task/v1
id: task-000003
title: "ORLEANS-P5-3: Rollback Runbook and Testing"
type: chore
status: not-started
priority: high
owner: "unassigned"
skills: ["docs","testing-dotnet-unit","orleans"]
depends_on: ["ORLEANS-P5-1", "ORLEANS-P5-2"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- Must be able to revert feature flag toggles and data migrations quickly and safely if issues are discovered during rollout.
- Rollback should be simple (flag toggle) where possible; data rollback paths must be documented and tested.

## Acceptance Criteria
- [ ] Rollback runbook in `docs/orleans-rollback.md`
- [ ] Automated rollback test (enable → migrate → rollback → verify)
- [ ] Data integrity verification after rollback
- [ ] Clear escalation path and owner contacts

## Plan / Approach
1. Draft `docs/orleans-rollback.md` with step-by-step rollback procedures, owner contacts, and verification steps.
2. Implement automated integration tests in `SAASTools.AppHost.Tests/Integration/Orleans/RollbackTests.cs` that simulate enable → migrate → rollback → verify.
3. Define data verification scripts/queries and safety checks to validate integrity post-rollback.
4. Conduct a tabletop run with the on-call/ops team to validate the runbook.

## Files to Create
- `docs/orleans-rollback.md`
- `SAASTools.AppHost.Tests/Integration/Orleans/RollbackTests.cs`

## Acceptance Tests / Validation
- CI-run rollback test in integration test suite.
- Clear set of verification queries demonstrating no lost/inconsistent data after rollback.

## Next Steps
- Assign an owner and schedule a short tabletop walk-through with ops and platform on-call.
