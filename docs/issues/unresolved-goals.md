---
created: 2026-03-15
updated: 2026-03-23
category: system
status: current
doc_kind: node
id: unresolved-goals
summary: Canonical carryover list for high-level goals that remain unresolved and are no longer active.
tags: [goals, carryover, planning]
related: [goal-contract-governance]
---

# Unresolved Goals

## Purpose / Usage

- Canonical persistent carryover for unresolved high-level goals between sessions.
- Include only goals that are both:
  - unresolved (`partial` or `not-complete`), and
  - not active in any current in-flight plan/session.
- Do not list active in-flight goals here.
- Remove goals once they are resolved (`complete`) or become active again in an in-flight plan/session.
- No archive requirement for removed goals.
- Default sync lane: `@doc-writer`, using read-only instructions emitted by `@goal-reviewer`.
- When `GOAL_REVIEW.unresolved_goals_path = NONE`, workflows either do nothing or run a removal-only clean-up based on `resolved_goals_to_remove` (entries now complete or active again).
- Sync existing entries by **Goal Statement** as the stable key; preserve the existing `GOAL-YYYYMMDD-##` heading and `First Seen` date when updating an entry.

## Entry Schema (Deterministic)

Use one section per unresolved goal in this exact field order:

```md
### GOAL-YYYYMMDD-##
- **Goal Statement:** <stable high-level outcome statement>
- **Completion State:** partial | not-complete
- **First Seen:** YYYY-MM-DD
- **Last Reviewed:** YYYY-MM-DD
- **Source Artifact:** <repo-relative path or session-state artifact path>
- **Why Still Unresolved:** <1-3 short bullets or sentence>
- **Carryover Intent (Next Session):** <single sentence>
- **Owner:** <role or team>
- **Notes:** <optional concise context>
```

## Active Entries

### GOAL-20260323-01
- **Goal Statement:** Deploy or implement the out-of-repo Vultr-hosted Obsidian sync service so Elegy Copilot can pull note changes end-to-end.
- **Completion State:** partial
- **First Seen:** 2026-03-23
- **Last Reviewed:** 2026-03-23
- **Source Artifact:** ~/.elegy/session-state/923fc643-41d3-40c6-8e64-194660ff936e/plan.md
- **Why Still Unresolved:** This repo now covers the local client, UI, sync state, and tracker monitoring, but the Vultr-hosted remote sync service remains outside repo scope and is not yet deployed/implemented.
- **Carryover Intent (Next Session):** Keep this as the single out-of-repo follow-up to stand up the Vultr sync service and validate end-to-end pull sync against it.
- **Owner:** workflow-orchestrator

