---
id: task-000011
title: "Create Stack Auditor"
status: done
priority: high
owner: agent
depends_on: ["task-000008", "task-000009"]
skills: ["marten-linq-querying", "wolverine-core", "orleans", "signalr"]
created: 2026-01-31
updated: 2026-01-31
---

# task-000011: Create Stack Auditor

## Summary
Create an auditor that detects the tech stack and runs pattern-based checks for common mistakes using loaded skills.

## Acceptance Criteria
- [x] Agent file `.github/agents/stack-auditor.agent.md` created
- [x] Uses stack-detector skill to identify frameworks
- [x] Auto-loads relevant skills (marten, wolverine, orleans, etc.)
- [x] Runs pattern-based checks per skill
- [x] Produces `.instructions-output/stack-audit.md`
- [x] Includes checklist with pass/fail per pattern

## Implementation Notes
- Pattern examples:
  - Marten: "No GroupBy in LINQ", "OrderBy before Skip/Take"
  - Wolverine: "Handler discovery configured", "AutoApplyTransactions enabled"
  - Orleans: "Grain state persistence configured"
- Report format: checklist grouped by framework

## Completion Log
- **2026-01-31**: Created `.github/agents/stack-auditor.agent.md` with:
  - Framework-specific pattern checklists for Marten, Wolverine, Orleans, SignalR, Aspire
  - Severity guidelines (Critical/High/Medium/Low)
  - Grep-based detection patterns for each check
  - Structured output format for `.instructions-output/stack-audit.md`
  - Integration with stack-detector skill for framework detection
