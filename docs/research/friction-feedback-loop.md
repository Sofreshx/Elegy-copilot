---
created: 2026-03-06
updated: 2026-03-06
category: research
status: draft
doc_kind: node
id: friction-feedback-loop
summary: Research analysis of the friction feedback gap and proposed three-pronged upgrade.
tags: [friction, feedback, research]
---

# Friction Feedback Loop

## Problem Statement

Friction entries are logged via the `implementation-friction` skill to `docs/issues/implementation-friction-log.md`, but never systematically reviewed, clustered, or escalated. Friction data is write-only. No agent or workflow reads the log to identify patterns, prioritize remediation, or trigger action. This creates a growing backlog of invisible technical debt.

## Proposed Solution

Three-pronged upgrade to close the feedback loop:

### Prong 1: Log Template Upgrade

Add 3 new optional fields to the friction log entry template:

- **Cluster ID** — groups related friction entries for pattern detection.
- **Recurrence Count** — tracks how frequently a friction pattern is observed.
- **Auto-Remediation Candidate** — yes/no flag indicating whether the friction is amenable to automated fix.

### Prong 2: Escalation Signal

The `implementation-friction` skill detects when friction recurs (3+ occurrences) or reaches critical importance, and sets `friction_escalation_requested: true` flag in the completion summary. The orchestrator detects this flag and routes to the `friction-feedback` on-demand skill.

### Prong 3: Friction Feedback Skill

New on-demand skill that reviews accumulated friction entries, clusters by ID, ranks by recurrence × importance, and produces top-3 actionable remediation recommendations.

## Depth-1 Escalation Design

The leaf agent (`implementation-friction`) sets a flag only; the orchestrator reads the flag and routes. No leaf-to-leaf skill loading occurs. This is compliant with the depth-1 execution model.

## Log Template Upgrade Detail

Three new optional fields added after the existing 7 fields:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| Cluster ID | string | optional | Groups related friction entries for pattern detection. |
| Recurrence Count | integer | optional | How many times this friction pattern has been observed. |
| Auto-Remediation Candidate | yes/no | optional | Whether this friction is amenable to automated fix. |

## Risks and Open Questions

- **Cluster ID assignment** — should cluster IDs be assigned manually by the agent or automated via heuristic matching?
- **Recurrence count accuracy** — how reliably can recurrence be tracked across sessions and repos?
- **False positive escalation threshold** — is 3 occurrences the right threshold, or should it be configurable?
- **Privacy of friction data** — if friction logs are shared across repos, do they risk leaking project-specific implementation details?
