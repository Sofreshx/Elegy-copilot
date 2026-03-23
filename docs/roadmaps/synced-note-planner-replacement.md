---
doc_kind: roadmap
roadmap_slug: synced-note-planner-replacement
title: Synced-Note Planner Replacement
version: 1
---

# Synced-Note Planner Replacement

## Overview
Replace the current planner intake path with a synced-note-driven planning entrypoint that remains subordinate to the canonical planning authorities already defined in this repo. The current state already includes synced-note source contracts, tracker-side source persistence plus CRUD wiring, and Planning support for synced-note-seeded plan provenance. The remaining work is to validate the source-management slice, add deterministic sync and lock orchestration, promote note content into Repository Backlog and Roadmap surfaces instead of using notes as the source of truth, expose operator controls in the app, and harden the full flow for GitHub-first and self-host-friendly deployments.

## Roadmap Items
### RM-synced-note-planner-replacement-001 — Validate source lifecycle and backend choice
- Phase: foundation
- Status: planned
- Summary: Finish the source-management contract with full CRUD validation, explicit GitHub-first behavior, and Gitea or generic git compatibility that is safe for self-hosted deployments.
- Backlog IDs: RB-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-002 — Add deterministic sync refresh orchestration
- Phase: runtime
- Status: planned
- Summary: Introduce the actual sync worker plus watcher, cooldown, lock, retry, and fail-closed execution rules that keep note refresh deterministic and prevent overlapping repo work.
- Backlog IDs: RB-002
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-003 — Promote synced notes into canonical planning flow
- Phase: promotion
- Status: planned
- Summary: Convert synced note content into canonical planning actions by supporting explicit promotion into Repository Backlog, Roadmap, and Plan Pack seeding flows, alongside operator-facing source management UI.
- Backlog IDs: RB-003, RB-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-synced-note-planner-replacement-004 — Harden rollout and end-to-end validation
- Phase: hardening
- Status: planned
- Summary: Prove the full feature is safe to ship through end-to-end validation, observability, operational safeguards, and rollout guidance for both hosted and self-hosted note-sync backends.
- Backlog IDs: RB-002, RB-004, RB-005
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none