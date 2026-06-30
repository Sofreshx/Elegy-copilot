---
created: 2026-03-15
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: out-of-scope-findings
summary: Persistent record of meaningful issues discovered during work but intentionally deferred as out of scope.
tags: [scope, findings, deferred]
related: [goal-contract-governance]
---

# Out-of-Scope Findings

## Purpose / Usage

- Record meaningful issues identified during implementation but deferred from the current scope.
- Include only findings that are actionable or decision-relevant for future sessions.
- Keep entries concise and explicit about deferral reason.

## Entry Schema (Deterministic)

Append entries using this exact field order:

```md
### FINDING-YYYYMMDD-##
- **Finding:** <short issue statement>
- **Discovered In:** <task/feature/session context>
- **Why Out of Scope:** <scope boundary or constraint>
- **Impact if Deferred:** low | medium | high | critical
- **Recommended Next Action:** <one practical next step>
- **Target Surface:** <backlog | roadmap | direct implementation>
- **Linked Artifacts:** <optional repo-relative paths>
```

## Active Entries

<!-- Append deferred findings below using the schema above. -->

