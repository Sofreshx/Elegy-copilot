---
created: 2026-02-27
updated: 2026-03-06
category: system
status: current
doc_kind: node
id: implementation-friction-log
summary: Append-only log of recurring implementation friction discovered during normal delivery work.
tags: [friction, refactor-input, delivery]
---

# Implementation Friction Log

## Usage
- Append-only log for recurring codebase pain points.
- Keep entries concise; do not derail active implementation.
- `Suggestion` can be blank when analysis would be too expensive in current scope.

## Entry Template

### [YYYY-MM-DD HH:mmZ] Short title
- **Reason:**
- **Importance:** low | medium | high | critical
- **Context:**
- **Symptoms:**
- **Impact on Delivery:**
- **Suggestion:**
- **Confidence:** low | medium | high
- **Cluster ID:** _(optional)_
- **Recurrence Count:** _(optional)_
- **Auto-Remediation Candidate:** _(optional, yes/no)_
