---
created: 2026-03-31
updated: 2026-04-25
category: meta
status: archived
doc_kind: node
summary: Legacy repo-local roadmap snapshot for UI runtime overlay work, kept only for compatibility and history.
---

# UI Runtime Overlay

## Overview
This repo-local roadmap is a legacy compatibility snapshot. Canonical roadmap authority now lives
under `~/.copilot/backlogs/{repo-name}/roadmaps/*.md`, so this file is historical only.

UI Runtime Overlay extends copilot-ui as the local control plane for attach-first runtime observation.
Current runtime behavior authority remains
[docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md); this roadmap focuses on the
remaining delivery work first and keeps completed foundation items short for lineage.

## Active roadmap items

### RM-ui-runtime-overlay-004 — Add operator-native overlay workflow to Home / Runtime
- Phase: Phase 1 - Runtime UX
- Status: in_progress
- Summary: Add the operator workflow to Home / Runtime, especially Sessions and Executor, so starting or resuming an overlay session feels native to copilot-ui and exposes repo context, evidence, and next actions in one place.
- Notes: Runtime -> Sessions now surfaces a lightweight overlay sessions workspace with compact session summaries, resume/select controls, refresh, and one-click handoff into Executor. Executor remains the full create/mutate/queue workspace, so this UX slice is active but not complete yet.
- Backlog IDs: RB-012
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-ui-runtime-overlay-005 — Deliver element-level issue and change-request flow
- Phase: Phase 1 - Annotation and Change Flow
- Status: planned
- Summary: Deliver element selection, issue posting, and narrow change-request handoff so operators can flag a live element, describe what is wrong, and route a scoped fix request into executor-backed work against the linked repo.
- Backlog IDs: RB-014
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-ui-runtime-overlay-006 — Add bounded validation and UI quality signals
- Phase: Phase 2 - Validation and Quality Signals
- Status: planned
- Summary: Add bounded validation loops and stronger runtime observation for slow, inert, broken, or suspicious UI states using snapshot comparison, interaction timing, hot-reload checks, and targeted operator confirmation, with automation optional rather than assumed.
- Backlog IDs: RB-016
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-ui-runtime-overlay-007 — Keep Preview Mode as an explicit later recipe lane
- Phase: Phase 3 - Preview Readiness
- Status: proposed
- Summary: Define Preview Mode as a later, explicit-recipe extension that can launch isolated preview environments only where the repo declares how they work, keeping generic backend mocking and builder-style scope out of the early roadmap.
- Backlog IDs: RB-017
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

## Completed foundation

### RM-ui-runtime-overlay-001 — Bind Attach Mode to verified runtime and repo context
- Phase: Phase 0 - Attach Foundation
- Status: complete
- Summary: Establish Attach Mode session registration, runtime URL binding, selected-repo or folder linking, and capability gating so copilot-ui can safely attach to a real app and know which codebase it is allowed to affect.
- Notes: Delivered through verified runtime URL binding, selected Catalog repo linkage, persisted repo metadata, and fail-closed package-root validation.
- Backlog IDs: RB-011
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-ui-runtime-overlay-002 — Define the snapshot-first observation contract
- Phase: Phase 0 - Observation Contract
- Status: complete
- Summary: Define the snapshot-first live observation model for overlay sessions, including semantic snapshots, locator metadata, timing/state captures, and bounded evidence artifacts that describe real UI behavior without claiming full automation.
- Notes: Delivered through the current overlay observation, annotation, change-request, and quality-signal contract used by Executor.
- Backlog IDs: RB-013
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-ui-runtime-overlay-003 — Lock safety, authority, and fail-closed runtime rules
- Phase: Phase 0 - Safety and Authority
- Status: complete
- Summary: Lock the safety, authority, and fail-closed rules for live UI observation, repo linkage, planning promotion, and execution handoff so the feature stays honest about what it can observe, change, and persist.
- Notes: Delivered through selected-repo authority checks, package-root validation, closed-session mutation blocking, reservation safety, and rollback-safe Executor handoff.
- Backlog IDs: RB-015
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
