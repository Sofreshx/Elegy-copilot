---
created: 2026-03-31
updated: 2026-04-25
category: meta
status: archived
doc_kind: node
summary: Legacy repo-local roadmap snapshot for synced-note rollout and hardening, kept only for compatibility and history.
---

# Synced-Note Planner Replacement

## Overview
This repo-local roadmap is a legacy compatibility snapshot. Canonical roadmap authority now lives
under `~/.copilot/backlogs/{repo-name}/roadmaps/*.md`, so this file is historical only.

The repo-owned Obsidian bridge is now in place: tracker-backed source records and repo-scoped
active-source selection are wired into `copilot-ui`, pull sync is hardened with
lease/cooldown/retry/conflict handling, and external notes can seed plans or be explicitly promoted
into canonical backlog and roadmap docs. Current authority remains
[docs/system/obsidian-synced-notes-contract.md](../system/obsidian-synced-notes-contract.md),
[docs/system/planning-backlog-roadmap-contract.md](../system/planning-backlog-roadmap-contract.md),
and [docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md). The remaining active work is
the out-of-repo remote sync service lane plus rollout and operator hardening.

## Active roadmap items

### RM-synced-note-planner-replacement-004 — Complete the out-of-repo remote sync service lane
- Phase: deployment
- Status: planned
- Summary: Finish and deploy the external pull-feed service that the repo-owned client expects in production, including auth, hosting, operational ownership, and real source-backed feed behavior for selected synced-note sources.
- Notes: This roadmap slot historically covered the remaining refresh-orchestration and operator-management lineage as well; those `RB-002` and `RB-004` foundation slices are already delivered, and the open remainder now lives in `RB-005` for the external service lane that still feeds end-to-end hardening.
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

## Completed lineage

### RM-synced-note-planner-replacement-001 — Validate synced-note source lifecycle and backend contract
- Phase: foundation
- Status: complete
- Summary: Close the source-registration and backend-contract validation lane for tracker-backed synced-note sources without creating a competing planning authority.
- Notes: Retained for lineage; this scope is now covered by the shipped source registry, CRUD wiring, and foundation validation slice.
- Backlog IDs: RB-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-002 — Deliver deterministic synced-note refresh orchestration
- Phase: foundation
- Status: complete
- Summary: Add deterministic repo-scoped refresh orchestration with cooldown, overlap protection, and fail-closed sync handling.
- Notes: Retained for lineage; the current bridge already ships repo-scoped source selection plus pull sync with lease, cooldown, retry, and conflict handling.
- Backlog IDs: RB-002
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-003 — Complete planning promotion and operator-management foundation
- Phase: foundation
- Status: complete
- Summary: Finish the foundation slices that let synced notes promote into canonical planning docs and expose operator-facing management without making the note surface authoritative.
- Notes: Retained for lineage; canonical promotion paths and operator-facing note management now exist, so this roadmap slot remains historical.
- Backlog IDs: RB-003, RB-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
