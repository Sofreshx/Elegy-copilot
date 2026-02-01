---
id: task-000008
title: "Create Audit Executive Orchestrator"
status: done
priority: high
owner: agent
depends_on: []
skills: []
created: 2026-01-31
updated: 2026-01-31
---

# task-000008: Create Audit Executive Orchestrator

## Summary
Create a unified orchestrator agent that serves as the entry point for running any/all audit types. It delegates to specialized auditors and aggregates results.

## Acceptance Criteria
- [x] Agent file `.github/agents/audit-executive.agent.md` created
- [x] Accepts audit type parameter: `deploy`, `stack`, `test`, `e2e`, `security`, `all`
- [x] Delegates to appropriate specialized auditor(s)
- [x] Aggregates results into `.instructions-output/audit-summary.md`
- [x] Produces pass/warn/fail stats per auditor

## Implementation Notes
- Follow existing agent patterns (see `security-auditor.agent.md`, `test-executive.agent.md`)
- Use subagent delegation pattern
- Output format should be parseable by extension (standardized YAML front matter)
