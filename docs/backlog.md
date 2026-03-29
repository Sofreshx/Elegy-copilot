---
created: 2026-03-23
updated: 2026-03-28
category: meta
status: current
doc_kind: node
summary: Repository-backed backlog of queued and planned work across repo planning workstreams.
---

# Repository Backlog

<!-- REPOSITORY_BACKLOG_FORMAT_VERSION: 1 -->

Repository-scoped intake and queued work across repo planning workstreams. The current items span the remaining synced-note planner replacement work, orchestrator follow-up adoption for **Session Intent Frame** / **Session Closure Summary**, and the new **UI Runtime Overlay** lane for attach-first runtime observation in `copilot-ui`. Synced-note source contracts, tracker-side source persistence plus CRUD wiring, Planning seed provenance support, and the framing/closure contract hardening slice are already complete; the backlog below captures the remaining delivery, adoption, validation, and runtime-overlay planning work without changing canonical planning authorities or overpromising unsupported preview or automation behavior.

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

## RB-011 - Define the Attach Mode target contract for linked runtime and repo context
- Status: complete
- Roadmap IDs: RM-ui-runtime-overlay-001
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Define the Attach Mode target contract that binds a runtime URL, selected Catalog repo, optional folder or package-root override, and overlay session metadata so the system can inspect the live UI and route edits to the correct codebase.

### Key Points
- 2026-03-28: Reuse existing repo selection as the authority for what codebase the overlay may affect.
- 2026-03-28: Fail closed when the runtime, repo, or package root cannot be verified.
- 2026-03-29: The shipped overlay service now covers verified runtime URL parsing, selected Catalog repo binding, persisted repo metadata, and package-root validation without adding new backend routes.

## RB-012 - Add operator-facing overlay controls to Home / Runtime
- Status: in_progress
- Roadmap IDs: RM-ui-runtime-overlay-004
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 9

Add operator-facing overlay controls under Home / Runtime, centered on Sessions and Executor, so an operator can start, resume, inspect, and end overlay sessions without leaving copilot-ui's canonical control plane.

### Key Points
- 2026-03-28: The runtime hub should show attach state, selected repo, evidence status, and quick actions.
- 2026-03-28: Sandboxing may appear as an execution option but not as the primary product frame.
- 2026-03-29: Runtime -> Sessions now exposes a compact overlay sessions workspace with resume/select, refresh, and open-in-Executor actions, while Home / Runtime overview adds a selected/latest overlay resume quick action.
- 2026-03-29: Session creation, overlay mutation, and queue handoff intentionally remain in Executor so Home / Runtime does not duplicate the full CRUD surface.

## RB-013 - Define the live observation contract for overlay sessions
- Status: complete
- Roadmap IDs: RM-ui-runtime-overlay-002
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Establish the observation contract for live UI sessions, including semantic snapshots, element locator metadata, interaction events, and bounded timing or state captures that make UI inspection useful without pretending to be a full visual builder or full test suite.

### Key Points
- 2026-03-28: Snapshots are primary evidence and screenshots are secondary.
- 2026-03-28: Observation artifacts should support real issue triage and change requests, not just passive viewing.
- 2026-03-29: The current overlay contract already persists observations, annotations, change requests, and derived quality signals through the existing overlay APIs and store.

## RB-014 - Add element-level issue posting and change-request flow
- Status: planned
- Roadmap IDs: RM-ui-runtime-overlay-005
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Add element-level annotation, issue posting, and narrow change-request flow so operators can click a live UI element, describe the problem, and hand off a scoped fix request into executor-backed code changes against the linked repo.

### Key Points
- 2026-03-28: Issue or change-request drafts must carry element and evidence references.
- 2026-03-28: Promotion into canonical planning surfaces should be explicit rather than automatic.

## RB-015 - Define safety, authority, and capability boundaries for live UI editing
- Status: complete
- Roadmap IDs: RM-ui-runtime-overlay-003
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 10

Define safety, authority, and capability boundaries for observing a live app and editing real code, including unsupported-runtime gating, operator confirmation, and explicit separation between runtime observation, canonical planning docs, and session execution artifacts.

### Key Points
- 2026-03-28: Catalog repo selection remains the repo authority and Obsidian remains additive and non-canonical.
- 2026-03-28: Unsupported stacks or ambiguous targets must fail closed instead of inferring unsafe behavior.
- 2026-03-29: Existing service and route coverage now proves fail-closed runtime URL validation, repo/package-root authority checks, closed-session mutation blocking, reservation safety, and rollback-safe Executor handoff.

## RB-016 - Add bounded validation and UI-quality signal analysis
- Status: proposed
- Roadmap IDs: RM-ui-runtime-overlay-006
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 9

Create a bounded validation and UI-quality signal model that can catch slow buttons, inert controls, empty or stuck states, and obvious regressions using snapshot deltas, interaction timing, reload confirmation, and targeted operator checks.

### Key Points
- 2026-03-28: Validation must work even when scripted automation is limited.
- 2026-03-28: Playwright or E2E probes are optional amplifiers only when a repo already supports them.

## RB-017 - Define Preview Mode recipe contract for isolated UI previews
- Status: proposed
- Roadmap IDs: RM-ui-runtime-overlay-007
- Plan Refs: none
- Satisfied By Plan Ref: none
- Superseded By Plan Ref: none
- Abandoned By Plan Ref: none
- Importance: 7

Define the later Preview Mode recipe contract so isolated previews can be added after Attach Mode stabilizes, using explicit repo-declared launch recipes instead of generic backend mocking or early builder ambitions.

### Key Points
- 2026-03-28: Preview profiles should be explicit, capability-gated, and repo-readable.
- 2026-03-28: Generic mock-backend generation stays out of early phases.
