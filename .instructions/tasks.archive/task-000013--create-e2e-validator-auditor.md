---
id: task-000013
title: "Create E2E Validator Auditor"
status: done
priority: medium
owner: agent
depends_on: ["task-000008"]
skills: ["playwright-mcp"]
created: 2026-01-31
updated: 2026-01-31
---

# task-000013: Create E2E Validator Auditor

## Summary
Create an auditor focused on E2E setup health validation (distinct from e2e-ux-auditor which does UX exploration).

## Acceptance Criteria
- [x] Agent file `.github/agents/e2e-validator.agent.md` created
- [x] Validates app can start (headless mode)
- [x] Checks critical pages load without errors
- [x] Tests auth flow works (if configured)
- [x] Verifies API health endpoints respond
- [x] Supports headless and headed modes
- [x] Produces `.instructions-output/e2e-validation.md`
- [x] Delegates browser work to `e2e-playwright-mcp`

## Implementation Notes
- Focus on "does it work" not "is it good UX"
- Health check endpoints: `/health`, `/api/health`, etc.
- Minimal set of critical pages (home, login, one protected page)
- Report: pass/fail per check with response times
