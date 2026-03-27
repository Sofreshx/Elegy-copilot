---
created: 2026-03-23
updated: 2026-03-23
category: meta
status: current
doc_kind: node
summary: Repository-backed backlog of queued and planned work across repo planning workstreams.
---

# Repository Backlog

<!-- REPOSITORY_BACKLOG_FORMAT_VERSION: 1 -->

Repository-scoped intake and queued work across repo planning workstreams. The current items span the synced-note planner replacement work plus orchestrator follow-up adoption for **Session Intent Frame** / **Session Closure Summary**. Synced-note source contracts, tracker-side source persistence plus CRUD wiring, Planning seed provenance support, and the framing/closure contract hardening slice are already complete; the backlog below captures the remaining delivery, adoption, and validation work without changing canonical planning authorities or introducing out-of-scope memory/provider-routing work.

## RB-001 - Validate synced-note source lifecycle and backend contract
- Status: planned
- Roadmap IDs: RM-synced-note-planner-replacement-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 9

Close the remaining confidence gap around synced-note source registration before adding automated ingestion on top of it. This includes finalizing the GitHub-first backend contract, preserving Gitea and generic git compatibility, and covering the missing CRUD validation surface.

### Key Points
- 2026-03-23: Synced-note source contracts, tracker storage, gateway CRUD wiring, and Planning provenance are already implemented and passing their current slice tests.
- 2026-03-23: The remaining source-management gap is validation depth rather than missing foundation code, especially for GET-by-id, PUT, DELETE, and backend policy acceptance.

## RB-002 - Deliver deterministic synced-note refresh orchestration
- Status: proposed
- Roadmap IDs: RM-synced-note-planner-replacement-002, RM-synced-note-planner-replacement-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Add the actual sync worker and watcher flow that refreshes the selected note source on a bounded cadence, enforces cooldown rules, and refuses to trigger overlapping work for the same repo.

### Key Points
- 2026-03-23: Existing tracker watcher code already demonstrates the preferred debounce model and event fan-out pattern for local state surfaces.
- 2026-03-23: The feature must fail closed when a sync is stale, a lock already exists, or a repo already has active execution.

## RB-003 - Promote synced notes into canonical planning authorities
- Status: proposed
- Roadmap IDs: RM-synced-note-planner-replacement-003
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Ingest synced note content into the canonical planning flow so notes can seed Repository Backlog items, Roadmap items, or Plan Pack authoring without becoming a competing planning authority.

### Key Points
- 2026-03-23: Planning already preserves synced-note provenance when a plan draft is seeded from a synced-note artifact.
- 2026-03-23: Promotion rules must keep repo-backed backlog and roadmap docs authoritative and preserve explicit linked IDs for future Roadmap Sync.

## RB-004 - Add operator-facing synced-note management UI
- Status: proposed
- Roadmap IDs: RM-synced-note-planner-replacement-003, RM-synced-note-planner-replacement-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 8

Expose synced-note sources in the app so operators can register sources, inspect status, trigger a manual refresh, and understand why note-driven planning work is blocked or delayed.

### Key Points
- 2026-03-23: The gateway can already persist synced-note sources, but there is no first-class app surface for managing them.
- 2026-03-23: The UI must surface sync state and manual controls without implying that synced notes bypass repo-backed Repository Backlog, Roadmap, or Plan Pack workflows.

## RB-005 - Harden and validate end-to-end delivery
- Status: proposed
- Roadmap IDs: RM-synced-note-planner-replacement-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 9

Prove the feature works as an end-to-end system through deterministic tests, operational safeguards, and rollout guidance for both GitHub-hosted and self-hosted note sources.

### Key Points
- 2026-03-23: Validation so far covers the foundation slice only; there is not yet end-to-end coverage from note sync through planning promotion and session handoff.
- 2026-03-23: Operational hardening must include observability, bounded retries, lock cleanup, and release guidance for self-hosted environments such as Vultr + Gitea.

## RB-006 - Operationalize Session Intent Frame and Session Closure Summary runtime composition
- Status: proposed
- Roadmap IDs: RM-orchestrator-framing-and-closure-adoption-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Implement the runtime composition, refresh points, and inspection-ready orchestration surfaces for **Session Intent Frame** and **Session Closure Summary** so the summaries become executable and reviewable without becoming new planning authorities.

### Key Points
- 2026-03-23: The planning-ready implementation brief already exists at `docs/system/orchestrator/framing-closure-runtime-adoption.md`.
- 2026-03-23: Runtime adoption must preserve `plan.md`, Repository Backlog, Roadmap, and repo carryover docs as the canonical authorities and fail closed when persistence or projection is unavailable.

## RB-007 - Add session summary synthesis and fail-closed projection paths
- Status: proposed
- Roadmap IDs: RM-orchestrator-framing-and-closure-adoption-002
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 9

Add the backend or session-layer synthesis path that assembles framing and closure summaries, enforces fail-closed parsing or projection rules, and supports inspection surfaces without fabricating hidden durable state.

### Key Points
- 2026-03-23: Optional derived closeout surfaces such as `/api/sessions/:id/final` must remain projections or materializations rather than new required artifact contracts.
- 2026-03-23: Durable memory and provider-location routing remain explicitly out of scope for this workstream.

## RB-008 - Expose framing and closure follow-up buckets in Sessions and Planning UI
- Status: proposed
- Roadmap IDs: RM-orchestrator-framing-and-closure-adoption-003
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 8

Expose **Session Intent Frame**, **Session Closure Summary**, and their follow-up buckets in Sessions and Planning product surfaces so operators can inspect active continuation versus durable carryover outcomes without bypassing repo-backed planning docs.

### Key Points
- 2026-03-23: UI follow-up buckets must distinguish active continuation from durable carryover and preserve linked `RB-*` and `RM-*` IDs when work is promoted into repo-backed planning.
- 2026-03-23: Product surfaces must not imply that UI projections override Repository Backlog, Roadmap, or issue-doc authorities.

## RB-009 - Define a configurable Planning Surface Resolver contract and adoption path
- Status: proposed
- Roadmap IDs: RM-orchestrator-framing-and-closure-adoption-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 8

Define the **Planning Surface Resolver** contract and adoption path for configurable planning and carryover doc roots while keeping today’s repo-relative defaults explicit and fail closed when alternate routing is unsupported.

### Key Points
- 2026-03-23: Research for configurable planning or carryover doc roots is complete; this follow-up is the contract and adoption slice only.
- 2026-03-23: No provider-routing or provider-location routing implementation should be tracked as active work in this Repository Backlog.

## RB-010 - Define Workflow Change Policy and integrate policy snapshot handling
- Status: proposed
- Roadmap IDs: RM-orchestrator-framing-and-closure-adoption-005
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 8

Define the **Workflow Change Policy** contract and integrate policy snapshot handling so runtime and planning flows can apply the correct rewrite or refactor aggressiveness without over-expanding future backlog, roadmap, or execution updates.

### Key Points
- 2026-03-23: Research for rewrite or refactor aggressiveness is complete; the remaining work is the contract, policy semantics, and snapshot integration.
- 2026-03-23: This policy should guide mutation behavior and review expectations without turning Roadmap or Repository Backlog items into Plan Pack-level execution specs.
