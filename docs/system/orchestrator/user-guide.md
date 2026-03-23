---
created: 2026-02-23
updated: 2026-03-23
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

Instruction Engine also supports an explicit persisted session-state lane for teams that want
file-backed artifacts and an intentional handoff from planning to execution. That lane writes the
same plan-pack shape to `~/.copilot/session-state/<SESSION_ID>/` for downstream tooling.

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

This summary is composed from execution outcomes plus `@code-reviewer`, `@goal-reviewer`,
`@final-reviewer`, follow-up discovery, and validation lanes. The orchestrator is responsible for
normalizing those signals into one closure view instead of pretending one lane owns every closure fact.

## Quick Start

1. **Invoke**: Type `@orchestrator` followed by your request.
2. **Answer any clarifications**: The orchestrator may ask about ambiguities.
3. **Review the plan** (for non-trivial work): Approve, revise, or cancel.
4. **Watch it execute**: Work units are delegated to specialist agents.
5. **Pick follow-ups or stop**: After completion, choose next actions or stop.

## How Requests Are Routed

The orchestrator classifies every request by complexity:

| Complexity | What happens | Example |
|---|---|---|
| **Trivial** | Direct execution, no plan | "Fix the typo in README.md" |
| **Standard** | Plan → execute → verify | "Add a new API endpoint for user profiles" |
| **Complex** | Discuss → research → plan → execute → review → verify | "Redesign the authentication system" |

You don't choose the complexity — the orchestrator's `@o-reframer` subagent analyzes your request and classifies it automatically. If uncertain, it defaults to "standard" and may ask you to confirm scope.

## Default Routing Policy: `balanced-default`

`@orchestrator` remains the default general entry point even as more capability packs, bundles, and workflows become available.

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
- `@work-unit-runner`, `@impl-infra`, `@impl-business`
- `@code-explorer`, `@code-architect`, `@code-reviewer`
- `@research-ideation`, `@unit-test-runner`, `@doc-writer`, `@goal-reviewer`, `@final-reviewer`

It should **not** auto-select optional audit lanes, cross-model reviewers, provider/imported
capabilities, or persisted session-state workflows from fallback alone.

### When a persisted session-state lane is chosen instead

The default orchestrator path remains the recommendation for general work.

Use an explicit persisted session-state workflow when you need:

- persisted session-state planning/execution artifacts
- a repo-specific persisted workflow/profile selected by the user or repo
- a handoff that depends on those persisted artifacts

## The Lifecycle

### Phase 0: Bootstrap
Every invocation loads project context (architecture, conventions, constraints), detects whether the work is fresh or resumed, and can continue from user-provided prior plan, host/runtime session state, or explicit session artifacts when relevant. It also performs carryover hygiene when unresolved-goal context matters.

This is where the orchestrator establishes the first draft of the **Session Intent Frame**: what the
session is for, what prior state is trustworthy enough to resume from, what direction/carryover signals
matter, and what limitations already exist.

### Phase 1: Understand
Your request is analyzed by `@o-reframer`, which produces a structured brief: classification, scope,
risks, ambiguities, intent summary, scope edges, completion signals, and limitations/carryover hints.
For complex requests, the orchestrator may ask you to resolve ambiguities and may run
research/exploration first.

The orchestrator folds this into the **Session Intent Frame**, including what is in vs out, what "done"
means, and where confidence is still too low to proceed blindly.

### Phase 2: Plan (standard/complex only)
`@o-planner` produces a plan pack using the shared plan-pack structure. The orchestrator updates a
concise session-state summary from the returned plan so it can keep long work on track without
re-reading full history every step. It asks for plan approval only when unresolved scope, risky
tradeoffs, or explicit user preference makes that approval materially necessary.

Planning refines the **Session Intent Frame** into an execution-ready shape: success criteria,
validation expectations, missing work that still needs explicit handling, and whether any durable repo
planning surfaces should matter after the run. Plan packs remain execution artifacts, not replacements
for backlog or roadmap authority.

### Phase 3: Execute
The default execution topology is one ready work group at a time through `@work-unit-runner`. The
orchestrator delegates only the active group, tracks progress after each group, and uses direct
specialist implementers only when a single WU is clearly one-lane work. Implementer lanes may request
test scope, but long-running test commands stay in the dedicated runners: unit validation through
`@unit-test-runner`, and integration/E2E only through their dedicated user-confirmed lanes. Timeout,
stalled-output, and inconclusive validation are treated as completed attempts that trigger retry,
replan, or user input rather than indefinite waiting.

During execution, the orchestrator keeps the Session Intent Frame current enough to preserve
resumability, especially when scope edges change, confidence drops, or refactor/coherence work is
discovered.

### Phase 4: Verify
Final verification uses a layered end gate: `@code-reviewer` for final code quality, `@goal-reviewer` for high-level goal completion plus read-only unresolved-goal sync instructions, then `@doc-writer` for any required `docs/issues/unresolved-goals.md` reconciliation, and finally `@final-reviewer` for the requested-vs-delivered closure summary. The orchestrator now treats `GOAL_REVIEW` as an active gate:

- `APPROVED` → continue closure, and route any `docs/issues/unresolved-goals.md` sync through `@doc-writer`
- `NEEDS_REVISION` → go back to execution/replan for active-goal gaps instead of treating the run as done
- `BLOCKED` → pause closure until the missing goal/evidence context is supplied

When reconciliation runs, `@doc-writer` keeps only unresolved goals that are no longer active, preserves existing entries by Goal Statement, and removes carryover entries that are now complete or active again. When `GOAL_REVIEW.unresolved_goals_path = NONE`, the orchestrator either performs a removal-only clean-up (if prior carryover entries should now be removed) or leaves the file untouched.

Verification is also where the orchestrator assembles most of the **Session Closure Summary**:
requested-vs-delivered facts, goal closure, code-quality/coherence findings, validation confidence, and
limitations that prevent a stronger completion claim.

### Phase 5: Follow-Up
The orchestrator proposes 2-4 concrete next actions grounded in blockers, missing validation,
active-goal gaps, and carryover context before it proposes polish work. If nothing actionable remains
and closure is supported, it can finish automatically instead of forcing a follow-up prompt. Otherwise,
pick one to continue, or choose `Stop — all done` only when closure is actually supported.

This phase finalizes the **Session Closure Summary** by separating:

- active continuation work for the same session/request
- durable repo-planning follow-ups that belong in backlog/roadmap lanes
- carryover issue-doc material such as unresolved goals or out-of-scope findings

The orchestrator should say explicitly when a limitation remains unresolved rather than implying hidden
memory or automatic future pickup.

## Key Subagents

| Agent | Role |
|---|---|
| `@o-reframer` | Analyzes requests, classifies complexity |
| `@o-planner` | Produces plan packs from enriched briefs |
| `@work-unit-runner` | Implements individual work units |
| `@code-explorer` | Read-only codebase analysis |
| `@code-architect` | Design decisions and blueprints |
| `@code-reviewer` | Quality gates (APPROVED/NEEDS_REVISION/FAILED) |
| `@goal-reviewer` | High-level goal closure gate (`APPROVED|NEEDS_REVISION|BLOCKED`) plus per-goal completion states (`complete|partial|not-complete`) + read-only unresolved-goal sync instructions |
| `@doc-writer` | Documentation lane, including deterministic reconciliation of `docs/issues/unresolved-goals.md` after `@goal-reviewer` |
| `@final-reviewer` | Requested-vs-delivered closure summary and remaining-work signal that respects `GOAL_REVIEW` status |
| `@research-ideation` | Web + codebase research |
| `@unit-test-runner` | Unit test execution |
| `@integration-test-runner` | Integration tests (user-confirmed) |

## How `@search` and `@execute` fit in

Most users should still start with `@orchestrator`, not invoke discovery/apply agents directly.

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
- The orchestrator does not create repo-local planning artifacts as part of its normal flow.
- If you need persisted plan, proposition, handoff, and verification artifacts under
  `~/.copilot/session-state/<SESSION_ID>/`, use an explicit session-state workflow instead.

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
