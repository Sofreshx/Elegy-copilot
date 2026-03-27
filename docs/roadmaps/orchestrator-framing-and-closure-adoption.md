---
doc_kind: roadmap
roadmap_slug: orchestrator-framing-and-closure-adoption
title: Orchestrator Framing and Closure Adoption
version: 1
---

# Orchestrator Framing and Closure Adoption

## Overview
Operationalize **Session Intent Frame** and **Session Closure Summary** across orchestrator runtime, session inspection, and repo-planning follow-up seams without changing canonical planning authority boundaries. This Roadmap builds on the completed contract and prompt hardening slice documented in `docs/system/orchestrator/framing-closure-runtime-adoption.md`, plus completed research on configurable planning/carryover doc roots and rewrite/refactor aggressiveness policy. Durable memory and provider-location routing remain explicitly out of scope for this Roadmap.

## Roadmap Items
### RM-orchestrator-framing-and-closure-adoption-001 — Compose and refresh normalized session summaries
- Phase: runtime
- Status: planned
- Summary: Implement the runtime composition and refresh points for Session Intent Frame and Session Closure Summary so orchestrator state becomes inspectable and consistent across planning, replanning, execution, pause, and closeout transitions.
- Backlog IDs: RB-006
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-orchestrator-framing-and-closure-adoption-002 — Add summary synthesis and fail-closed projection rules
- Phase: projection
- Status: planned
- Summary: Add synthesis, parsing, and projection rules for framing and closure summaries so backend or session inspection surfaces can expose them deterministically without inventing new required artifacts or hidden durable state.
- Backlog IDs: RB-007
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-orchestrator-framing-and-closure-adoption-003 — Expose framing and closure follow-up buckets in product surfaces
- Phase: ui
- Status: planned
- Summary: Expose Session Intent Frame, Session Closure Summary, and their active-continuation versus durable-carryover follow-up buckets in Sessions and Planning surfaces while preserving Repository Backlog and Roadmap authority.
- Backlog IDs: RB-008
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-orchestrator-framing-and-closure-adoption-004 — Adopt a configurable Planning Surface Resolver contract
- Phase: planning-surfaces
- Status: planned
- Summary: Formalize how repo-relative planning and carryover surfaces are resolved or overridden through a Planning Surface Resolver contract while keeping today’s defaults explicit and unsupported alternates fail closed.
- Backlog IDs: RB-009
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none

### RM-orchestrator-framing-and-closure-adoption-005 — Add Workflow Change Policy and policy snapshot integration
- Phase: governance
- Status: planned
- Summary: Define rewrite/refactor aggressiveness policy and policy snapshot integration so planning and runtime mutations know when narrow edits are required versus when broader rewrites are allowed.
- Backlog IDs: RB-010
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
