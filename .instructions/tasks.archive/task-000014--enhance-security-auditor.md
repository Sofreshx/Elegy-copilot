---
id: task-000014
title: "Enhance Security Auditor"
status: done
priority: high
owner: agent
depends_on: ["task-000008"]
skills: ["security", "secrets-auditor"]
created: 2026-01-31
updated: 2026-01-31
---

# task-000014: Enhance Security Auditor

## Summary
Enhance the existing security-auditor with dependency vulnerability scanning, secrets integration, and improved reporting.

## Acceptance Criteria
- [x] Update `.github/agents/security-auditor.agent.md`
- [x] Keep existing orchestration (scanner → fixer)
- [x] Add dependency vulnerability scanning (known CVEs)
- [x] Integrate `secrets-auditor` skill
- [x] Add OWASP checklist per endpoint type
- [x] Enhanced report with severity stats and trends

## Implementation Notes
- Check `dotnet list package --vulnerable` output
- Check `npm audit` output for frontend
- Integrate secrets-auditor skill checks
- OWASP Top 10 checklist in report
- Preserve backward compatibility

## Completion Log
- Updated `.github/agents/security-auditor.agent.md` with:
  - Skills section referencing `secrets-auditor`
  - Phase 0: Dependency Vulnerability Scanning (.NET + Node.js)
  - Phase 1: Code Scanning (existing)
  - Phase 2: Secrets Scanning (integrated skill)
  - Phase 3: OWASP Top 10 Checklist with table
  - Phase 4: Remediation Cycle
  - Enhanced report format with Stats, Trends, OWASP Coverage sections
