---
id: task-000012
title: "Create/Enhance Test Auditor"
status: done
priority: high
owner: agent
depends_on: ["task-000008"]
skills: ["testing-dotnet-unit", "aspire-integration-tests"]
created: 2026-01-31
updated: 2026-01-31
---

# task-000012: Create/Enhance Test Auditor

## Summary
Create an auditor that combines actual coverage metrics with LLM analysis of test quality and gaps.

## Acceptance Criteria
- [x] Agent file `.github/agents/test-auditor.agent.md` created
- [x] Delegates to `test-scanner` for inventory
- [x] Runs coverage collection if tooling configured (coverlet)
- [x] Parses coverage results for actual %
- [x] LLM analyzes test quality and identifies gaps
- [x] Produces `.instructions-output/test-audit.md`

## Implementation Notes
- Check for `coverlet.collector` in test projects
- Run `dotnet test --collect:"XPlat Code Coverage"` if configured
- Parse coverage XML for summary stats
- LLM reviews: test naming, assertion quality, edge case coverage
- Report includes both metrics and qualitative assessment
