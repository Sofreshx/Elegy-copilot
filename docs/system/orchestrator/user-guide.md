---
created: 2026-02-23
updated: 2026-03-15
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

It should **not** auto-select optional audit lanes, provider/imported capabilities, or persisted
session-state workflows from fallback alone. The built-in planning workflow may still call
`@reviewer-opus-4-6` and `@reviewer-gpt-5-4` as the default plan-review pair.

### When a persisted session-state lane is chosen instead

The default orchestrator path remains the recommendation for general work.

Use an explicit persisted session-state workflow when you need:

- persisted session-state planning/execution artifacts
- a repo-specific persisted workflow/profile selected by the user or repo
- a handoff that depends on those persisted artifacts

## The Lifecycle

### Phase 0: Bootstrap
Every invocation loads project context (architecture, conventions, constraints), detects whether the work is fresh or resumed, and can continue from user-provided prior plan, host/runtime session state, or explicit session artifacts when relevant. It also performs carryover hygiene when unresolved-goal context matters.

### Phase 1: Understand
Your request is analyzed by `@o-reframer`, which produces a structured brief: classification, scope, risks, ambiguities. For complex requests, the orchestrator may ask you to resolve ambiguities and may run research/exploration first.

### Phase 2: Plan (standard/complex only)
`@o-planner` produces a plan pack using the shared plan-pack structure. Before execution, the orchestrator routes that plan through its primary planning-review pair: `@reviewer-opus-4-6` first, then `@reviewer-gpt-5-4`, and it keeps revising until both return `Verdict: APPROVED` or a genuine blocker requires clarification. Specialist reviewers remain available as targeted overlays: `@impl-reviewer` for request/spec coverage, `@logic-reviewer` for sequencing and correctness risks, `@consistency-reviewer` for convention/alignment risks, and `@code-reviewer` only as a broad fallback when no sharper lane fits. The orchestrator updates a concise session-state summary from the accepted plan so it can keep long work on track without re-reading full history every step. It asks for plan approval only when unresolved scope, risky tradeoffs, or explicit user preference makes that approval materially necessary.

### Phase 3: Execute
The default execution topology is one ready work group at a time through `@work-unit-runner`. The orchestrator delegates only the active group, tracks progress after each group, and uses direct specialist implementers only when a single WU is clearly one-lane work. Implementer lanes may request test scope, but long-running test commands stay in the dedicated runners: unit validation through `@unit-test-runner`, and integration/E2E only through their dedicated user-confirmed lanes. Timeout, stalled-output, and inconclusive validation are treated as completed attempts that trigger retry, replan, or user input rather than indefinite waiting.

### Phase 4: Verify
Final verification uses a layered end gate: `@code-reviewer` for final code quality, `@goal-reviewer` for high-level goal completion plus read-only unresolved-goal sync instructions, then `@doc-writer` for any required `docs/issues/unresolved-goals.md` reconciliation, and finally `@final-reviewer` for the requested-vs-delivered closure summary. The orchestrator now treats `GOAL_REVIEW` as an active gate:

- `APPROVED` → continue closure, and route any `docs/issues/unresolved-goals.md` sync through `@doc-writer`
- `NEEDS_REVISION` → go back to execution/replan for active-goal gaps instead of treating the run as done
- `BLOCKED` → pause closure until the missing goal/evidence context is supplied

When reconciliation runs, `@doc-writer` keeps only unresolved goals that are no longer active, preserves existing entries by Goal Statement, and removes carryover entries that are now complete or active again. When `GOAL_REVIEW.unresolved_goals_path = NONE`, the orchestrator either performs a removal-only clean-up (if prior carryover entries should now be removed) or leaves the file untouched.

### Phase 5: Follow-Up
The orchestrator proposes 2-4 concrete next actions grounded in blockers, missing validation, active-goal gaps, and carryover context before it proposes polish work. If nothing actionable remains and closure is supported, it can finish automatically instead of forcing a follow-up prompt. Otherwise, pick one to continue, or choose `Stop — all done` only when closure is actually supported.

## Key Subagents

| Agent | Role |
|---|---|
| `@o-reframer` | Analyzes requests, classifies complexity |
| `@o-planner` | Produces plan packs from enriched briefs |
| `@reviewer-opus-4-6` | Primary planning reviewer for cross-model plan risk and completeness review |
| `@reviewer-gpt-5-4` | Primary planning reviewer that validates the plan and prior review feedback |
| `@work-unit-runner` | Implements individual work units |
| `@code-explorer` | Read-only codebase analysis |
| `@code-architect` | Design decisions and blueprints |
| `@impl-reviewer` | Targeted overlay for plan-vs-request/spec fit and implementation-vs-spec review |
| `@logic-reviewer` | Optional overlay for plan or change review on correctness, sequencing, and edge cases |
| `@consistency-reviewer` | Optional overlay for plan or change review on conventions and alignment |
| `@code-reviewer` | Quality gates (APPROVED/NEEDS_REVISION/FAILED) |
| `@goal-reviewer` | High-level goal completion gate (`complete|partial|not-complete`) + read-only unresolved-goal sync instructions |
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
- In the default orchestrator path, planning review normally uses `@reviewer-opus-4-6` and `@reviewer-gpt-5-4` as the main gate before execution; narrower reviewer lanes are overlays, not replacements.
- The orchestrator does not create repo-local planning artifacts as part of its normal flow.
- If you need persisted plan, proposition, and verification artifacts under
  `~/.copilot/session-state/<SESSION_ID>/`, use an explicit session-state workflow instead.

The same plan-pack contract is shared across chat-first and persisted workflows so downstream
tooling can read a consistent shape.

### Resuming Sessions
If a session is interrupted, re-invoke `@orchestrator` with the prior plan summary, host/runtime session context, or the relevant session artifact context. The orchestrator should rebuild a concise active session state before continuing.

## Relationship to Persisted Session-State Workflows

Use `@orchestrator` when you want the recommended general workflow with in-chat planning and direct delegation.

Use an explicit persisted planning/execution lane when you need:

- persisted plan and proposition artifacts under `~/.copilot/session-state/`
- explicit reviewer-approved planning before execution handoff
- reuse of session artifacts in `copilot-ui` Sessions and Planning surfaces

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
