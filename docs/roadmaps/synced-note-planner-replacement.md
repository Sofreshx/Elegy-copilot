---
created: 2026-03-31
updated: 2026-03-31
category: meta
status: current
doc_kind: node
summary: Repo roadmap for completing the synced-note planner replacement rollout and operator hardening work.
---

# Synced-Note Planner Replacement

## Overview
The repo-owned Obsidian bridge is now in place: tracker-backed source records and repo-scoped active-source selection are wired into `copilot-ui`, pull sync is hardened with lease/cooldown/retry/conflict handling, and external notes can seed plans or be explicitly promoted into canonical backlog and roadmap docs. The remaining work is outside the core bridge itself: finish the out-of-repo remote sync service deployment story, then validate rollout and operational guidance end to end.

## Roadmap Items
### RM-synced-note-planner-replacement-004 — Complete the out-of-repo remote sync service lane
- Phase: deployment
- Status: planned
- Summary: Finish and deploy the external pull-feed service that the repo-owned client expects in production, including auth, hosting, operational ownership, and real source-backed feed behavior for selected synced-note sources.
- Backlog IDs: RB-005
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-005 — Validate rollout and operator guidance end to end
- Phase: hardening
- Status: planned
- Summary: Prove the shipped bridge against the deployed remote service with end-to-end validation, failure drills, rollout checks, and concise operator guidance for source selection, sync conflicts, cooldown/backoff, and recovery.
- Backlog IDs: RB-005
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
