---
created: 2026-03-23
updated: 2026-03-23
category: system
status: draft
doc_kind: node
id: orchestrator-framing-closure-runtime-adoption
summary: Planning-ready implementation brief for operationalizing Session Intent Frame and Session Closure Summary across orchestrator runtime and persisted-session surfaces.
tags: [orchestrator, session-state, runtime, implementation]
related: [orchestrator-user-guide, session-state-artifacts, copilot-ui-guide, planpack-spec, goal-contract-governance]
---

# Framing + Closure Runtime Adoption

## Purpose + Summary

This document is the planning-ready implementation brief for operationalizing the normalized
**Session Intent Frame** and **Session Closure Summary** across the orchestrator runtime and persisted
session-state workflows.

The goal is to make those concepts executable and inspectable without changing authority boundaries:

- they are orchestration summaries, not new portfolio-planning authorities
- they may live in chat-first state, host/runtime state, or existing persisted artifacts
- they must fail closed rather than invent hidden memory, new required files, or unsupported runtime
  guarantees

This brief defines the target architecture, staged workstreams, likely touchpoints, acceptance checks,
and compatibility rules for the first runtime-adoption slice.

## Target Architecture

### Core model

The orchestrator composes two normalized session summaries:

1. **Session Intent Frame**
   - current request intent
   - in-scope vs out-of-scope edges
   - success/completion signals
   - active constraints, risks, and ambiguity limits
   - relevant carryover, roadmap, backlog, or coherence signals that materially affect execution
2. **Session Closure Summary**
   - delivered vs requested work
   - validation/review evidence and confidence
   - unresolved gaps, blockers, and missing validation
   - concrete follow-ups categorized by active continuation vs durable carryover
   - explicit session limitations at close or pause

### Runtime placement

- **Chat-first default**: the orchestrator owns both summaries in chat plus host/runtime session state
  when available.
- **Persisted workflows**: existing artifacts such as `plan.md`, `handoff.md`, `proposition.md`, and
  `verification-guide.md` may reflect parts of those summaries when persistence is needed.
- **UI/API inspection surfaces**: `copilot-ui` may expose materialized or derived summary views, but
  those remain compatibility/projection surfaces rather than new canonical required artifacts.

### Authority boundary

- `plan.md` remains the canonical session execution artifact when a persisted workflow is used.
- `docs/backlog.md`, `docs/roadmaps/*.md`, and issue-doc carryover files remain the canonical durable
  planning and carryover authorities.
- The framing/closure summaries must not silently replace backlog, roadmap, unresolved-goal, or repo
  documentation governance.

## Phased Workstreams

### Phase 1 — Contract and prompt hardening

- Align orchestrator, planner, and related docs on the normalized framing model.
- Remove terminology drift around persisted session-state layout and goal-review status semantics.
- Preserve current fail-closed behavior: no new runtime/API obligations yet.

### Phase 2 — Runtime composition and update points

- Define where the orchestrator composes the initial Session Intent Frame.
- Define mandatory refresh points after reframing, planning, replan, and meaningful execution changes.
- Define where the Session Closure Summary is assembled from reviewer and validation evidence at close
  or pause.

### Phase 3 — Persisted/session inspection projection

- Map which existing artifacts may reflect framing/closure data when persistence is requested.
- Treat `/api/sessions/:id/final` as an optional materialized/derived closeout surface, not a new
  required artifact contract.
- Keep the persisted lane compatible with chat-first runs that never materialize a dedicated closeout
  file.

### Phase 4 — Rollout and acceptance validation

- Validate prompt/doc/schema consistency with the existing documentation and agent-schema validators.
- Confirm that persisted-session docs, UI guide text, and planner contracts do not contradict each
  other.
- Record any remaining runtime/UI implementation work as follow-up backlog items rather than folding it
  into this docs-and-contract slice.

## Likely File Touchpoints

Primary docs/contracts:

- `engine-assets/agents/orchestrator.agent.md`
- `engine-assets/agents/o-reframer.agent.md`
- `engine-assets/agents/o-planner.agent.md`
- `docs/system/orchestrator/user-guide.md`
- `docs/system/session-state-artifacts.md`
- `docs/system/planpack-spec.md`
- `docs/system/copilot-ui-guide.md`

Likely runtime/projection follow-up touchpoints for a later implementation wave:

- `copilot-ui/routes/sessions*.js`
- `copilot-ui/tests/api-contract.test.js`
- any host/runtime session-state adapter that already stores or rehydrates session summaries

## Acceptance Checks

The runtime-adoption slice is ready when all of the following are true:

1. The orchestrator has an explicit contract to compose an initial Session Intent Frame before active
   planning/execution proceeds.
2. The orchestrator contract defines when that frame must be refreshed as scope, confidence, or
   carryover context changes.
3. The orchestrator contract defines Session Closure Summary assembly at completion or pause using
   existing reviewer and validation lanes.
4. Persisted-session docs state clearly that framing/closure data may be reflected through existing
   artifacts without introducing a new required artifact file.
5. `copilot-ui` docs describe `/api/sessions/:id/final` as optional materialized/derived closeout
   output rather than a new canonical required artifact.
6. Planner contracts, goal-review semantics, and session-artifact docs use consistent terminology for
   goal states, gate status, and the canonical `plan.md` layout.

## Compatibility + Fail-Closed Rules

- Do not claim hidden durable memory.
- Do not require a new `final` artifact file for every session.
- Do not treat UI/API projections as the authority over orchestration state.
- If runtime/host state cannot supply enough evidence for a stable persisted closeout summary, keep the
  Session Closure Summary in chat-only form or return no derived summary surface.
- Do not let persisted summary projections rewrite backlog, roadmap, unresolved-goals, or other durable
  repo-planning surfaces without their own explicit workflow.
- Preserve existing review-lane ownership:
  - `@goal-reviewer` owns gate status plus per-goal completion assessment
  - `@final-reviewer` owns requested-vs-delivered closure analysis
  - the orchestrator normalizes those outputs into the Session Closure Summary

## Risks

- **Authority drift**: framing/closure summaries could be mistaken for new durable planning authorities.
- **Artifact creep**: implementation could accidentally introduce new required files or duplicated
  closeout state.
- **Semantic confusion**: gate status and per-goal completion states may be conflated if prompt/doc
  contracts drift again.
- **Projection staleness**: derived UI/API closeout surfaces may lag behind the real runtime summary if
  derivation rules are underspecified.
- **Coupling risk**: configurable roots or rewrite-policy changes could be mixed into this runtime
  adoption slice and expand scope prematurely.

## Adjacent Research Tracks (Not in Main Slice)

These are related follow-ups, but they are not part of the main framing/closure runtime-adoption
implementation slice:

- **Configurable planning surfaces / doc roots** — how workflows choose or override repo-relative
  planning and carryover locations.
- **Workflow change policy / rewrite aggressiveness** — how aggressively documentation or workflow
  automation may rewrite existing planning surfaces vs requiring narrower edits.
- **Roadmap/backlog tracking synthesis** — how framing/closure discoveries should be routed into durable
  planning lanes without collapsing authority boundaries.

## Explicitly Out of Scope

- durable memory implementation
- memory export/import or hidden cross-session recall
- provider-routing or provider-location routing implementation
- runtime/UI/API implementation work beyond the contracts and planning guidance documented here
- any new required session artifact beyond the already documented surfaces
