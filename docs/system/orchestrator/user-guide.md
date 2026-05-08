---
created: 2026-02-23
updated: 2026-04-27
category: system
status: current
doc_kind: node
id: orchestrator-user-guide
summary: How to use the unified orchestrator and how it routes and executes work.
tags: [orchestrator]
---

# Orchestrator User Guide

## What Is the Orchestrator?

The `@orchestrator` is the single recommended entry point for general complex work in projects using Instruction Engine. It replaces Executive (v1), Executive2, Executive2.5, and Executive2-Fast with one unified agent for the default workflow.

You invoke `@orchestrator` and describe what you need. It handles everything — understanding your request, planning, delegating implementation to specialists, running reviews, and proposing follow-ups.

The default path is still chat-first. For long work, the orchestrator keeps a concise active session state in chat and host/runtime state when available, and only switches to a persisted session-state lane when you explicitly ask for file-backed planning/execution or the active repo/profile requires it.

For write-capable feature or modification work, the orchestrator is docs-first. It loads the
smallest relevant canonical docs entrypoint before implementation and expands only as the current
step needs more detail. When intended design, behavior, or workflow policy changes, the
orchestrator is also docs-update-first: the first execution slice should update the relevant
canonical docs before or alongside implementation.

Across planning, review, and verification, the orchestrator inherits the shared calibrated questioning and depth policy from [docs/system/calibrated-questioning-and-depth-governance.md](docs/system/calibrated-questioning-and-depth-governance.md). In practice, it should answer from canonical docs or repo evidence when that evidence is deterministic, carry a recommended assumption only when the remaining branch is not outcome-changing, and ask you only when the unresolved branch would materially change scope, architecture, validation, verdict, or a proceed-anyway decision.

Instruction Engine also supports an explicit persisted session-state lane for teams that want
file-backed artifacts and an intentional handoff from planning to execution. In that lane,
`@o-planner` still returns content only; the orchestrator materializes the same plan-pack shape to
`~/.copilot/session-state/<SESSION_ID>/` through `@doc-writer` or another explicit
markdown-writing lane for downstream tooling.

The default autonomous-decision log, when the host/runtime records one, belongs in user-local app
data managed by the host/runtime. Host/runtime-managed autonomous or auto-mode decisions should go
there when that seam exists. It is an operational audit surface, not canonical intent, and it does
not replace repo-local docs or persisted session-state artifacts.

## Normalized Session Framing

The orchestrator now uses two normalized framing concepts across chat-first and persisted workflows:

- **Session Intent Frame** — the orchestrator's normalized start-of-session framing concept. It captures
  what the user is trying to achieve now, what is in scope vs out of scope, what counts as success,
  what confidence/ambiguity limits apply, and which carryover or repo-direction signals matter before
  execution begins.
- **Session Closure Summary** — the orchestrator's normalized end-of-session summary concept. It captures
  what was delivered, what confidence supports that claim, what validation actually ran, what missing
  work or follow-ups remain, and whether the session is closing as done or pausing with explicit
  carryover.

These are orchestration concepts, not new repo artifacts and not new authority lanes. They normalize
what the orchestrator already has to understand and report across reframing, planning, execution,
review, and follow-up.

### What the Session Intent Frame Should Cover

At session start, the orchestrator should normalize:

- the user's intent in one concise summary
- current scope and explicit non-goals
- success/completion signals
- known ambiguities, risks, and limitations
- the relevant project-direction context, including roadmap/backlog/carryover signals when they matter
- refactor, code-quality, or coherence concerns that must influence routing or review
- the best currently available resumability source: chat context, host/runtime session state, or
  explicit session artifacts

This frame is assembled from the user request, `@o-reframer`, lightweight exploration, approved plan
content, and any relevant carryover docs. No single downstream lane owns the whole frame.

### What the Session Closure Summary Should Cover

At session end or pause, the orchestrator should normalize:

- delivered work vs requested work
- review and validation evidence with explicit confidence
- remaining gaps, blockers, or missing validation
- concrete follow-ups and whether they belong to active continuation, durable backlog, or carryover docs
- project-direction signals discovered during the run, such as roadmap pressure, backlog-worthy work,
  refactor debt, or coherence concerns
- limitations of the run, including cases where evidence is incomplete or the user stopped before
  closure

This summary is composed from execution outcomes, `@code-reviewer`, validation lanes, and any
durable planning or carryover state the orchestrator selected during the run. Closure authority stays
with the orchestrator: it normalizes reviewer findings, validation evidence, and carryover decisions
into one closure view instead of delegating stop/go judgment to helper lanes.

## Quick Start

1. **Invoke**: Prefer `@orchestrator-claude` or `@orchestrator-gpt` for normal work; use the base orchestrators only as compatibility surfaces when the model-specific entrypoint is unavailable or the host model is unknown.
2. **Answer interactive clarifications**: When blocking clarification or a proceed-anyway decision is needed, the orchestrator uses `vscode/askQuestions` through the interactive flow.
3. **Review the plan interactively** (for non-trivial work): Approve, revise, or cancel in that flow rather than through a plain-text end-of-plan question.
4. **Watch it execute**: Work units are delegated to specialist agents.
5. **Pick follow-ups or stop**: After completion, choose next actions or stop.

## Which Orchestrator?

Model-specific orchestrator variants are the preferred shipped entrypoints. Instruction Engine centers orchestration on the flagship model families — `@orchestrator-claude` for Claude Sonnet 4.6 sessions and `@orchestrator-gpt` for GPT-5.4 sessions. The base (model-agnostic) variants remain compatibility surfaces when the host model is unknown or a model-specific entrypoint is unavailable. See `docs/system/model-capability-profile.md` for the underlying model profiles.

| Your environment | Your host model | Preferred entrypoint | Compatibility fallback |
|---|---|---|---|
| VS Code | Claude Sonnet 4.6 / Claude-hosted | `@orchestrator-claude` | `@orchestrator` |
| VS Code | GPT-5.4 / GPT-hosted | `@orchestrator-gpt` | `@orchestrator` |
| VS Code | Unknown/other | `@orchestrator` | NONE |
| Copilot CLI | Claude Sonnet 4.6 / Claude-hosted | `@orchestrator-claude-cli` | `@orchestrator-cli` |
| Copilot CLI | GPT-5.4 / GPT-hosted | `@orchestrator-gpt-cli` | `@orchestrator-cli` |
| Copilot CLI | Unknown/other | `@orchestrator-cli` | NONE |

**Key differences:**
- **Claude variants** are the preferred flagship entrypoint for ambiguous or conversational work. They keep orchestration on Claude Sonnet 4.6, use Claude-backed reframing, and delegate only the dedicated research lane to GPT-5.4 when deeper evidence is warranted.
- **GPT variants** are the preferred flagship entrypoint for well-scoped structured work. They still rely on the Claude-backed `@o-reframer` lane to sharpen raw prompts before GPT-led planning and execution.
- **CLI variants** keep Copilot CLI's native Rubber Duck review behavior instead of explicit plan-review agents.
- **Code exploration** stays on `@code-explorer` with an Auto/smaller-model posture so premium reasoning remains concentrated at the orchestration edge.
- **Research** is consolidated to `@deep-researcher` as the single orchestrator-only GPT-5.4 research lane.
- **Implementation** stays lean: `@execute` remains the capability-brief extraction lane, and `@impl` is the default shipped write-capable implementation lane.
- **Testing** is consolidated to `@test-runner`, which owns lean risk-based validation selection inside
  one lane: run the narrowest proof that closes the active risk, then escalate only when policy,
  coupling, or missing evidence requires broader coverage.
- **Roadmap/backlog planning surfaces** remain orchestrator-owned. When persistence is needed, the orchestrator selects the surface and routes the actual write through existing writing lanes and skills rather than dedicated backlog/roadmap planner agents.

## How Requests Are Routed

The orchestrator classifies every request by complexity:

| Complexity | What happens | Example |
|---|---|---|
| **Trivial** | Direct execution, no plan | "Fix the typo in README.md" |
| **Standard** | Plan → execute → verify | "Add a new API endpoint for user profiles" |
| **Complex** | Discuss → research → plan → execute → review → verify | "Redesign the authentication system" |

You don't choose the complexity — the orchestrator's Claude-backed `@o-reframer` subagent analyzes your request and classifies it automatically. If uncertain, it defaults to "standard" and may ask you to confirm scope.

### Planning Surface Routing

The reframing step also assigns an explicit planning-surface contract so the orchestrator can choose between durable planning, session execution planning, both, or neither without guessing.

| Field | Allowed values | Meaning |
|---|---|---|
| `planning_surface` | `plan-pack` \| `roadmap` \| `both` \| `none` | Which planning surface, if any, should be used |
| `session_horizon` | `single-session` \| `multi-session` | Whether the request should close in one execution session or span durable follow-up |
| `execution_readiness` | `ready` \| `stageable` \| `not-ready` | Whether execution can start now, needs staging first, or is blocked on more input |
| `overlap_risk` | `low` \| `medium` \| `high` | Risk of confusing durable planning with active execution or creating bounded validation overlap |

Selection rules:

- `planning_surface: plan-pack` means the request should produce or use a session-scoped execution plan for work that is ready to run now.
- `planning_surface: roadmap` means the request belongs on the durable multi-session planning surface and should not be turned into active execution work yet.
- `planning_surface: both` means durable roadmap work happens first, then the orchestrator generates a linked plan pack that preserves the relevant durable IDs for execution.
- `planning_surface: none` means no roadmap or plan-pack artifact is required for the request.

`session_horizon: multi-session` normally aligns with `planning_surface: roadmap` or `planning_surface: both`, while `session_horizon: single-session` usually aligns with `plan-pack` or `none`.

Plan-pack generation runs only when `planning_surface` includes `plan-pack` and `execution_readiness` is `ready` or `stageable`. `planning_surface: roadmap`, `planning_surface: none`, and `execution_readiness: not-ready` must not invoke the plan-pack lane.

Delivery-oriented requests such as commit prep, review prep, and CI result checks are valid request classes in this routing model. They often use `planning_surface: none` when the user wants readiness assessment, packaging help, or evidence review only. That does not imply push automation, remote pull-request writes, or remote CI mutation.

### Default Session Scope

The default execution scope is one active issue or one tightly related slice per session. Repository
Backlog and Roadmap sit above `plan.md` as durable selection surfaces; the plan pack is only for the
single slice chosen for active execution now.

For mixed or unrelated multi-ask requests, the orchestrator should:

1. select one active slice
2. queue the rest on durable backlog/roadmap surfaces with stable canonical IDs
3. keep the active session plan focused on the selected slice only

If the request bundles unrelated work and no obvious active slice is dominant, fail closed with
clarification or durable planning only. Do not blend multiple unrelated asks into one active plan pack.

## Default Routing Policy: `balanced-default`

When the host model is known, the model-specific orchestrators remain the preferred general entry point. `@orchestrator` stays as the model-agnostic compatibility fallback when that model-specific routing is unavailable.

The default policy is **balanced-default**:

- the orchestrator should prefer capabilities that are **installed + active + eligible**
- activation comes from **user-global defaults** plus any **repo-specific override**
- eligibility is **curated and visible**, not "anything installed can be auto-picked"
- explicit user requests can still override the default filter, but that should be called out as an override rather than treated as normal default routing

### Policy precedence

When the orchestrator decides what it may select by default, it should apply this precedence:

1. explicit user request
2. repo-specific activation/profile override
3. user-global default profile
4. built-in fallback baseline when runtime policy state is not yet available

### Safe fallback before backend eligibility state exists

Current prompt/runtime hardening assumes a safe fallback when the backend has not yet surfaced a compact routing-policy snapshot.

In that case, the orchestrator stays inside a curated shipped first-party baseline for automatic routing:

- `@o-reframer`, `@o-planner`, `@search`, `@execute`
- `@impl`
- `@code-explorer`, `@code-reviewer`
- `@deep-researcher`, `@doc-writer`
- `@test-runner`

It should **not** auto-select optional audit lanes, provider/imported capabilities, compatibility-only split planning/testing/research lanes, persisted session-state workflows, or cross-model reviewers from fallback alone. Planning-time cross-model reviewers remain workflow-specific and should run only when an explicit workflow or runtime policy snapshot selects them.

### When a persisted session-state lane is chosen instead

The default orchestrator path remains the recommendation for general work.

Use an explicit persisted session-state workflow when you need:

- persisted session-state planning/execution artifacts
- a repo-specific persisted workflow/profile selected by the user or repo
- a handoff that depends on those persisted artifacts

## V1 Nested Delegation Topology

The shipped V1 topology keeps `@orchestrator` as both the root session owner and the root loop owner.

- The effective repo depth cap is 3: `@orchestrator` -> approved coordinator -> leaf.
- Host/runtime nesting support up to depth 5 is runtime headroom only; the shipped repo topology stays bounded and explicit rather than generally recursive.
- Planning uses direct orchestrator-managed surface selection. `@o-planner` stays the default leaf for plan-pack generation; durable backlog/roadmap persistence stays orchestrator-owned and should use existing writing lanes plus planning skills when a repo write is required.
- Validation uses the single leaf `@test-runner`, which selects the narrowest required unit,
  integration, browser, or E2E coverage inside one lane instead of routing through separate validation
  coordinators or stacking broad checks by default.
- Write-capable implementation lanes and reviewer lanes remain leaf-only in V1. `@impl` is the default shipped implementation lane; older split implementation lanes are compatibility-only.
- Coordinator-to-coordinator chains are disallowed in V1.
- When nested planning is unavailable or disabled, use the legacy-depth-1 fallback: direct orchestrator -> `@o-planner` planning.

## The Lifecycle

### Phase 0: Bootstrap
Every invocation loads project context (architecture, conventions, constraints), detects whether the work is fresh or resumed, and can continue from user-provided prior plan, host/runtime session state, or explicit session artifacts when relevant. It also performs carryover hygiene when unresolved-goal context matters.

For feature or modification work, bootstrap starts from the smallest relevant canonical docs
entrypoint, usually `docs/system/index.md`, a relevant MOC, or a deterministic node for the lane in
question. The orchestrator expands to additional docs only when the current step needs them.

If the intended change alters canonical design, behavior, or workflow policy, bootstrap should plan
the first execution slice so the relevant canonical docs are updated before or alongside
implementation.

`docs/system/**` remains canonical intent. Other maintained docs in `docs/**` and approved repo
operating docs remain important design and operating context, but they are not peer authority with
the canonical system docs.

If intended work materially contradicts current documentation, the orchestrator must surface the
contradiction and ask the user for direction before it continues with implementation or other
write-capable work.

This is where the orchestrator establishes the first draft of the **Session Intent Frame**: what the
session is for, what prior state is trustworthy enough to resume from, what direction/carryover signals
matter, and what limitations already exist.

### Phase 1: Understand
Your request is analyzed by `@o-reframer`, which produces a structured brief: classification, scope,
risks, ambiguities, intent summary, scope edges, completion signals, and limitations/carryover hints.
For complex requests, the orchestrator may ask you to resolve ambiguities and may run
research/exploration first.

That same reframing step records `planning_surface`, `session_horizon`, `execution_readiness`, and
`overlap_risk`, then explicitly chooses `plan-pack`, `roadmap`, `both`, or `none` before planning or
execution begins.

When the request contains multiple unrelated asks, the reframing result should identify which slice is
active now and which asks should be preserved as durable queued follow-up instead of being blended into
the same active session scope.

The orchestrator folds this into the **Session Intent Frame**, including what is in vs out, what "done"
means, which validation layers are required, and where confidence is still too low to proceed blindly.

When the request is about reviewing or improving already-implemented work rather than planning fresh
implementation, the same framing still applies: the orchestrator should explicitly decide whether the
goal is assessment only, assessment plus targeted fixes, or a broader replanning loop, then route the
smallest review and validation lanes that can challenge the current state responsibly.

### Phase 2: Plan (standard/complex only)
`@o-planner` produces a plan pack using the shared plan-pack structure. The orchestrator updates a
concise session-state summary from the returned plan so it can keep long work on track without
re-reading full history every step. It asks for plan approval only when unresolved scope, risky
tradeoffs, or explicit user preference makes that approval materially necessary.

When a persisted session-state workflow is active, `@o-planner` still returns only the **Plan Pack**
and **Progress Tracker** content. The orchestrator owns materializing `plan.md` from that returned
content through `@doc-writer` or another explicit markdown-writing lane. Fresh sessions may not have
`~/.copilot/session-state/<SESSION_ID>/plan.md` yet, so the planner must not poll or probe session
artifact paths before the first write; any prior revision context must be supplied inline by the
caller.

This phase runs only when the selected surface includes a plan pack and `execution_readiness` is
`ready` or `stageable`. Roadmap-only and `none` requests skip the plan-pack lane entirely.

The plan pack itself should stay single-slice: it may contain multiple work units for the active slice,
but it should not become a catch-all container for unrelated overflow asks. Overflow belongs on durable
backlog/roadmap surfaces, not inside active-session execution scope.

Planning uses direct orchestrator → planning-leaf delegation. `@o-planner` is the default planner.
For complex plan-pack work with large exploration payloads, failed prior plans, or unusually high
decomposition risk, the orchestrator may explicitly escalate to `@o-planner-gpt`. The orchestrator
gathers exploration context via `@search` / `@execute` and passes findings to the selected
leaf-only planner.

Planning refines the **Session Intent Frame** into an execution-ready shape: success criteria,
validation expectations, missing work that still needs explicit handling, and whether any durable repo
planning surfaces should matter after the run. Plan packs remain execution artifacts, not replacements
for backlog or roadmap authority. When `planning_surface: roadmap`, no plan pack should be generated.
When `planning_surface: both`, the roadmap slice is established first and the generated plan pack must
carry the linked durable IDs forward into execution.

When Phase 2 challenges a plan, the orchestrator applies that same shared policy inside the selected planning surface: stress-test assumptions and missing evidence without inventing speculative blockers, and escalate to an interactive user question only when the remaining branch materially changes the outcome.

When Phase 2 needs plan approval, blocking clarification, or an explicit proceed-anyway decision, use
`vscode/askQuestions` through the interactive flow.
Do not fall back to plain-text end-of-plan questions for those decisions.

### Phase 3: Execute
The default execution topology is one ready work group at a time through the lean implementation surface centered on `@impl`. The orchestrator delegates only the active slice, tracks progress after each slice, and keeps `@execute` available only for capability-brief extraction when additional constraints or authoring guidance are needed. Implementer lanes may request test scope, but long-running test commands stay in the consolidated `@test-runner` lane. That lane should run the narrowest proof that closes the active risk and add integration or browser/E2E coverage only when repo policy, cross-boundary coupling, or missing evidence makes the broader layer necessary. Timeout, stalled-output, and inconclusive validation are treated as completed attempts that trigger retry, replan, or user input rather than indefinite waiting.

For any write-capable work unit that affects behavior, workflow policy, or a documentation-backed
feature, the delegated leaf must independently load the smallest relevant canonical docs entrypoint
before editing. The orchestrator brief and any exploration context are inputs, not a substitute for
leaf-level canonical-doc bootstrap.

If a write-capable leaf reports a material contradiction with current documentation, the orchestrator
must pause execution and ask the user for direction before it retries, replans, or delegates further
write-capable work.

When a completed or frozen slice can be validated without reopening active writes, the orchestrator may
route that bounded validation through `@test-runner`. That overlap is conditioned on `overlap_risk`,
dependency safety, and current repo policy constraints. Integration and browser/E2E validation remain
policy/risk-driven escalations rather than default follow-on checks, and browser/E2E validation stays
serial with active write work.

During execution, the orchestrator keeps the Session Intent Frame current enough to preserve
resumability, especially when scope edges change, confidence drops, or refactor/coherence work is
discovered.

If execution discovers meaningful out-of-scope work, the orchestrator should keep the current slice
bounded and route the discovery into durable planning carryover with stable linked IDs rather than
quietly widening the active session.

### Phase 4: Verify
Final verification uses a lean end gate: `@code-reviewer` for final code quality and request/spec-fit,
`@test-runner` for the narrowest required validation surface, and `@doc-writer` only when durable carryover
artifacts under `~/.copilot/backlogs/{repo-name}/**` need to be written or reconciled. The
orchestrator owns the high-level judgment about whether goals are complete, partial, or blocked, and
it decides whether unresolved goals or Repository Backlog carryover should be persisted.

When reconciliation runs, `@doc-writer` keeps only unresolved goals that are no longer active,
preserves existing entries by Goal Statement, and removes carryover entries that are now complete or
active again.

When closure also needs durable Repository Backlog carryover, the orchestrator should preserve an
explicit `session_backlog_path` and prefer
`~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md` for new carryover.

Verification is also where the orchestrator assembles most of the **Session Closure Summary**:
requested-vs-delivered facts, goal closure, validation requirements, tested coverage, code-quality /
coherence findings, validation confidence, and limitations or coverage gaps that prevent a stronger
completion claim.

This phase uses the same inherited policy to challenge whether the available review and validation evidence actually closes the request. Reviewer responsibilities, depth limits, and any explicit deeper overlays remain governed by [docs/system/calibrated-questioning-and-depth-governance.md](docs/system/calibrated-questioning-and-depth-governance.md).

If mandatory validation did not run, the orchestrator must say so explicitly. Missing required
validation lowers closure confidence and may keep the run in a paused or incomplete state rather than a
confident done state.

### Phase 5: Follow-Up
The orchestrator proposes 2-4 concrete next actions grounded in blockers, missing validation,
active-goal gaps, and carryover context before it proposes polish work. If nothing actionable remains
and closure is supported, it can finish automatically instead of forcing a follow-up prompt. Otherwise,
pick one to continue, or choose `Stop — all done` only when closure is actually supported.

This phase finalizes the **Session Closure Summary** by separating:

- active continuation work for the same session/request
- durable repo-planning follow-ups that belong on orchestrator-managed backlog/roadmap surfaces
- carryover issue-doc material such as unresolved goals or out-of-scope findings

When durable repo-planning follow-ups exist, the orchestrator should structure Repository Backlog
carryover under `work_not_done`, `issues`, and `suggestions`, then route any required persistence or
cleanup through existing writing lanes such as `@doc-writer` so
`~/.copilot/backlogs/{repo-name}/backlogs/<session-slug>.md` stays the primary end-of-session
backlog surface.

No-silent-loss rule: overflow asks, deferred work, and out-of-scope discoveries must either be written
to durable planning surfaces with stable canonical IDs or be called out explicitly as not preserved.
Issue docs can hold narrative detail, but future-action selection should still resolve through linked
`RB-*` / `RM-*` items rather than freeform prose alone.

When roadmap-linked work finishes, the orchestrator should ensure completed roadmap items leave the
active roadmap surface. Keeping history is fine, but done items should move to an explicit completed or
archive area instead of staying mixed with active roadmap candidates.

The orchestrator should structure active continuation work, blockers, and carryover ownership
directly. Fast git/workspace/session-state scans may still help identify open work, but they do not
decide whether `Stop — all done` is allowed.

The orchestrator should say explicitly when a limitation remains unresolved rather than implying hidden
memory or automatic future pickup.

## Key Subagents

| Agent | Role |
|---|---|
| `@o-reframer` | Claude-backed request analysis and classification for routing, scope edges, and ambiguity capture |
| `@o-planner` | Produces plan packs from enriched briefs |
| `@reviewer-sonnet-4-6` | VS Code / non-CLI planning reviewer for cross-model plan risk and completeness review |
| `@reviewer-gpt-5-4` | VS Code / non-CLI planning reviewer that validates the plan and prior review feedback |
| `@code-explorer` | Read-only codebase analysis on an Auto/smaller-model posture |
| `@execute` | Capability-brief extraction lane that loads the selected skill, agent, or canonical doc and distills only the constraints needed downstream |
| `@impl` | Default shipped write-capable implementation lane |
| `@code-reviewer` | Single shipped reviewer leaf for quality gates plus request/spec-fit review |
| `@doc-writer` | Documentation lane, including deterministic reconciliation of carryover docs plus orchestrator-owned markdown persistence for session artifacts and repo-backed planning surfaces when the orchestrator selects them |
| `@deep-researcher` | Single orchestrator-only GPT-5.4 research lane for evidence-backed option evaluation and systematic analysis |
| `@test-runner` | Consolidated unit, integration, and browser/E2E validation lane |

Governance, conventions, and authoring guidance should prefer skills and canonical docs rather than a
long tail of direct-invocation helper agents.

## How `@search` and `@execute` fit in

Most users should still start with the flagship model-specific orchestrators — `@orchestrator-claude` / `@orchestrator-gpt` in VS Code-style chat surfaces or `@orchestrator-claude-cli` / `@orchestrator-gpt-cli` in Copilot CLI — rather than invoking discovery/apply agents directly. The base orchestrators remain compatibility fallbacks.

Inside the default workflow:

- `@search` is used when the right capability is **not already obvious** from the request or when the orchestrator needs to resolve a skill, canonical doc, or eligible imported capability without loading everything first.
- `@execute` is used **after** capability resolution to turn that capability into a compact execution brief for the downstream implementation/review worker.
- Deterministic control-lane steps such as reframing, planning, or running a known review step do **not** need broad search first.

Direct invocation is still useful when you want only one stage:

- use `@search` to ask "what capability should handle this?"
- use `@execute` to ask "what constraints/steps matter from this already-selected capability?"

## Plan Packs

For standard and complex work, the orchestrator uses the shared Plan Pack structure defined in `docs/system/planpack-spec.md`.

- In the default orchestrator path, plan review and progress tracking stay in chat.
- In the default orchestrator path, plan review and active session state stay in chat or host/runtime state when available.
- `@orchestrator` (VS Code / non-CLI) normally uses `@reviewer-sonnet-4-6` and `@reviewer-gpt-5-4` as the manual planning gate before execution; narrower reviewer lanes are overlays, not replacements.
- `@orchestrator-cli` (Copilot CLI) uses Rubber Duck for cross-model critique instead of explicitly delegating to the reviewer pair.
- The orchestrator does not create repo-local planning artifacts as part of its normal flow.
- If you need persisted plan, proposition, handoff, and verification artifacts under
  `~/.copilot/session-state/<SESSION_ID>/`, use an explicit session-state workflow instead.
- In that persisted workflow, the orchestrator routes markdown artifact writes for `plan.md`,
  `handoff.md`, `proposition.md`, and `verification-guide.md` through `@doc-writer` (or another
  explicit markdown-writing lane). `execution-state.json` stays a runtime/host-managed overlay
  rather than a doc-writer artifact.

The **Session Intent Frame** and **Session Closure Summary** may be represented in chat, host/runtime
state, or persisted session artifacts depending on the workflow. They do not create new authority over
repo backlog, roadmap, goal carryover, or follow-up discovery docs.

The same plan-pack contract is shared across chat-first and persisted workflows so downstream
tooling can read a consistent shape.

When a persisted workflow is later inspected through `copilot-ui`, the primary Sessions summary surface is
the derived metadata on `GET /api/sessions/:id/structured-state`:

- `meta.intentFrame`
- `meta.closureSummary`

Those views are derived from existing persisted inputs (`plan.md`, `handoff.md`, `proposition.md`,
`verification-guide.md`, review ledger, checkpoints, next unit, and resume metadata). The supporting
artifacts remain useful persisted detail surfaces, but they are not separate competing summary
authorities. `GET /api/sessions/:id/final` remains compatibility-only and should not be treated as the
authoritative Sessions summary path.

When validation-governance data is available, the derived summaries should also surface what validation
was required, what coverage actually ran, which broader layers were not required, and what gaps or
limitations remain.

### Resuming Sessions
If a session is interrupted, re-invoke `@orchestrator` with the prior plan summary, host/runtime
session context, or the relevant session artifact context. The orchestrator should rebuild a concise
active session state and refresh the Session Intent Frame before continuing.

## Relationship to Persisted Session-State Workflows

Use `@orchestrator` when you want the recommended general workflow with in-chat planning and direct delegation.

Use an explicit persisted planning/execution lane when you need:

- persisted plan, proposition, and `handoff.md` artifacts under `~/.copilot/session-state/`
- explicit reviewer-approved planning before execution handoff
- reuse of session artifacts in `copilot-ui` Sessions and Planning surfaces

In that lane, markdown artifact persistence remains orchestrator-owned: it materializes
`plan.md` from `@o-planner`'s returned Plan Pack + Progress Tracker and uses the same explicit
markdown-writing pattern for `handoff.md`, `proposition.md`, and `verification-guide.md` when the
workflow chooses to write them. `execution-state.json` remains runtime/host overlay data rather
than part of the markdown-writing lane.

## Limitations

- The normalized Session Intent Frame and Session Closure Summary are orchestration concepts, not new
  runtime APIs or repo artifact requirements.
- State preservation across sessions still depends on chat context, host/runtime state, explicit
  session artifacts, and approved carryover docs. Hidden durable memory is not implemented.
- Future memory/export seams may later preserve durable decisions, open risks, accepted follow-ups, or
  project-direction summaries, but that behavior is not implemented by this documentation update.

## Richer Host Integration

Some hosts may provide richer review or walkthrough tooling around the orchestrator workflow. When those tools are available, they can improve plan review or guided validation.

The baseline workflow, however, must still work with standard `vscode/askQuestions` alone. Richer tooling is optional, not required for the default path.

## Migration from Old Executives

| Old Agent | Action |
|---|---|
| `@executive` | Use `@orchestrator` instead |
| `@executive2` / `@executive2-planner` | Use `@orchestrator` instead |
| `@executive2p5` / `@executive2p5-planner` | Use `@orchestrator` instead |
| `@executive2-fast` | Use `@orchestrator` instead (trivial requests use fast path) |

The older executive names are historical references only and should not be used for new work.

### What changed
- **Single entry point**: No more choosing between 5+ executive variants.
- **Automatic complexity routing**: The orchestrator decides the right approach.
- **Fast path**: Trivial requests execute directly without planning overhead.
- **Context curation**: Each subagent gets only what it needs, keeping context clean.
- **Follow-up loop**: The orchestrator keeps proposing next actions when actionable work remains, but it can also finish automatically when the goal and closure gates are satisfied and no real follow-up remains.

## Tips

- **Be specific**: "Add a Wolverine HTTP endpoint for creating users" is better than "Add user stuff."
- **Trust the routing**: You don't need to specify whether work is trivial or complex.
- **Review plan packs**: For important work, take time to review the plan before approving.
- **Use follow-ups**: After completion, the orchestrator's follow-up proposals are often valuable (tests, docs, related refactors).
- **Resume interrupted work**: Invoke `@orchestrator` again and include the prior plan or session context you want it to continue from.

