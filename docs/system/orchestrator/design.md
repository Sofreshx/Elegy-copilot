---
created: 2026-02-23
updated: 2026-02-23
category: system
status: draft
doc_kind: node
id: orchestrator-design
summary: Historical design notes for the orchestrator architecture; current behavior is defined by the shipped agent file and user guide.
tags: [orchestrator, design]
---

# Orchestrator Agent Design

## Date
2026-02-17

## Status
Draft — pending review

> Historical design note: this document records the original orchestrator design pass.
> For current operational behavior, use `engine-assets/agents/orchestrator.agent.md`
> and `docs/system/orchestrator/user-guide.md`.

## Overview
The Orchestrator is the next-generation unified agent that replaces Executive (v1), Executive2, Executive2.5, and Executive2-Fast with a single, clean entry point. It consolidates the best patterns from our executive lineage and external systems (GSD, Copilot Orchestra, Wrapzii Orchestration) while eliminating the complexity that plagued previous versions.

**Design Philosophy**: The orchestrator is a thin routing and context-curation layer. It does NO leaf work. It delegates EVERYTHING. Its value is in understanding what's needed, routing to the right specialist, and curating context so each specialist gets exactly what it needs.

## Principles

### P1: Single Entry Point
The user only needs to invoke `@orchestrator`. Everything else is internal delegation. No more choosing between executive, executive2, executive2p5, or executive2-fast.

### P2: Thin Coordinator
The orchestrator NEVER:
- Writes production code
- Runs tests directly
- Creates files outside of plan/progress artifacts
- Does "heavy lifting" (exploration, research, implementation)

It ONLY:
- Understands requests
- Classifies complexity and type
- Delegates to specialized subagents
- Curates context for each delegation
- Tracks progress
- Reports results
- Proposes next actions

### P3: Context Preservation Through Delegation
The orchestrator's main context window stays clean because ALL work happens in subagent contexts. Each subagent gets a curated, minimal prompt — not a context dump.

### P4: Right-Sized Response
Not every request needs full planning. The orchestrator routes by complexity:
- **Trivial** (< 5 min, single file, no ambiguity): Fast path → direct delegation to work-unit-runner with minimal context
- **Standard** (clear scope, known patterns): Plan → execute → verify
- **Complex** (multi-component, ambiguous, risky): Discuss → research → plan → execute → review → verify

### P5: Durable But Lightweight State
Plan packs (2 markdown files) for standard+ work. No SQLite, no task file hierarchies. For trivial work, no persistence at all.

## Architecture

### Agent Hierarchy

```
User
  └── @orchestrator (thin coordinator, never implements)
        ├── @o-planner (planning subagent — produces plan packs)
        ├── @o-reframer (request analysis + clarification)
        ├── @work-unit-runner (implementation of single work units)
        ├── @code-explorer (read-only codebase analysis)
        ├── @code-architect (design decisions)
        ├── @code-reviewer (quality gates)
        ├── @research-ideation (web + codebase research)
        ├── @unit-test-runner (test execution)
        ├── @integration-test-runner (with user approval)
        ├── @reviewer-opus-4-6 (cross-model review)
        ├── @reviewer-gpt-5-3-codex (cross-model review)
        ├── @e2e-browser (E2E testing with user approval)
        └── @doc-writer (documentation)
```

### New Subagents

#### @o-reframer (Request Reframer)
**Purpose**: Analyze the user's request, identify ambiguities, classify complexity, and produce a structured brief.
**Tools**: read, search (read-only)
**Input**: Raw user request + compressed project context
**Output**: Structured brief with:
- Classification: trivial | standard | complex
- Type: feature | bugfix | refactor | testing | review | research | docs | ad-hoc
- Scope: files/components likely affected
- Ambiguities: gray areas needing user input
- Dependencies: skills needed, external APIs involved
- Risk level: low | medium | high
**When called**: Every request (fast — just analysis, no heavy work)

#### @o-planner (Orchestrator Planner)
**Purpose**: Produce actionable plan packs. Replaces executive2p5-planner for the orchestrator workflow.
**Tools**: read, search, edit (only the approved plan artifact surface), web/fetch, agent/runSubagent (code-explorer, code-architect, research-ideation)
**Wait** — this violates "no subagent chaining". Instead, the orchestrator should call code-explorer/code-architect/research-ideation and pass results to o-planner.

**Revised**: @o-planner is a LEAF agent (no subagent calls). The orchestrator gathers exploration context and passes it to o-planner.
**Tools**: read, search, edit (only the approved plan artifact surface)
**Input**: Enriched brief + exploration findings + project context
**Output**: Plan pack (2 files) following existing plan-pack format

### Lifecycle Phases

#### Phase 0: Bootstrap (every invocation)
1. Identify target repo (not instruction-engine)
2. Load project truth sources:
   - `.github/copilot-instructions.md`
   - `docs/system/**`
   - repo docs such as `README.md` and `docs/`
3. Compress to ~150-line project context summary
4. Resume from host/session artifacts or prior user-provided plan context when relevant.

#### Phase 1: Understand (reframe + classify)
1. Delegate to @o-reframer with user request + project context
2. Parse classification result
3. Route by complexity:
   - **Trivial**: Skip to Phase 3 (direct execution, no plan)
   - **Standard**: Proceed to Phase 2a (plan)
   - **Complex**: Proceed to Phase 1b (discuss/research), then Phase 2

##### Phase 1b: Discuss & Research (complex only)
1. If ambiguities identified by reframer:
   - Use `planReview` (Seamless Agent) or `askQuestions` to present ambiguities and get structured user input
2. If research needed:
   - Delegate to @research-ideation with specific questions
3. If codebase exploration needed:
   - Delegate to @code-explorer with relevant scope
4. Merge all findings into an enriched brief

#### Phase 2: Plan
1. Load relevant skills (read SKILL.md files)
2. Delegate to @o-planner with:
   - Enriched brief from Phase 1
   - Project context (compressed)
   - Exploration findings
   - Skill instructions
3. Present plan to user:
   - For standard: use `planReview` (Seamless Agent) for inline feedback
   - For complex: use `planReview` with cross-model review first
4. If user requests changes: incorporate feedback, re-invoke o-planner
5. If approved: persist plan pack, proceed to Phase 3

Cross-model review (complex plans only):
- Send plan to @reviewer-opus-4-6
- Send plan + opus feedback to @reviewer-gpt-5-3-codex
- Reconcile and update plan if needed

#### Phase 3: Execute
For each work unit (respecting dependency order):

1. **Context gathering** (parallelizable):
   - Run @code-explorer with WU scope (if not trivial)
   - Load any referenced skills
   
2. **Delegate to @work-unit-runner** with:
   - Work unit spec
   - Exploration context
   - Skill instructions
   - Previous attempt history (if retrying)

3. **Handle result**:
   - **Success**: Update progress tracker, check for test requests
   - **REPLAN_REQUESTED**: Evaluate scope — minor: update WU, major: back to Phase 2
   - **NEW_WORK_DISCOVERED**: Add to plan pack or create follow-up

4. **Testing checkpoint** (after each group):
   - Delegate to @unit-test-runner
   - On failure: create fix WU, max 3 attempts, then ask user

5. **Code review** (after each group or final):
   - Delegate to @code-reviewer
   - Handle: APPROVED → continue, NEEDS_REVISION → re-run WU, FAILED → ask user

#### Phase 4: Verify & Complete
1. Run final review (code-reviewer on all changes)
2. Optional: cross-model review for non-trivial changes
3. Present summary to user via askUser:
   - What changed
   - What was tested
   - How to validate
   - Git branch (if applicable)

#### Phase 5: Follow-Up Loop
1. Generate 2-4 concrete follow-up proposals
2. Present via askQuestions with "Stop — all done" option
3. If user picks a follow-up: classify and execute (back to Phase 1)
4. If stop: end session

### Tools

```yaml
tools:
  # Core
  - read
  - search
  - edit
  - execute/runInTerminal
  - agent/runSubagent
  - todo
  
  # User interaction (prefer Seamless Agent when available)
  - vscode/askQuestions          # batch questions, fallback
  - jraylan.seamless-agent/askUser        # rich single-question confirmation
  - jraylan.seamless-agent/planReview     # plan approval with inline comments
  - jraylan.seamless-agent/walkthroughReview  # UAT walkthroughs
  
  # Web
  - web/fetch
  - web/githubRepo
```

### State Management

**Plan pack state** (standard+ complexity only):
- shared plan-pack structure, carried either in chat or host-managed session artifacts depending on workflow
- no repo-local planning artifact hierarchy required for the default orchestrator path

**Session detection**: use host/session artifacts or user-provided prior plan context when resuming work.

**No other state files**: No SQLite, no task files, no separate plan artefacts.

**Durable memory**:
- repo docs and host/session artifacts capture long-lived context; a separate memory-condensation agent is not part of the shipped surface

### Context Curation Protocol

This is the orchestrator's most important job — curating what each subagent receives.

| Subagent | Receives |
|----------|----------|
| @o-reframer | User request (verbatim), compressed project context (~150 lines) |
| @o-planner | Enriched brief, exploration findings, skill instructions, project context |
| @work-unit-runner | WU spec, exploration context, skill instructions, previous attempts |
| @code-explorer | Scope description, relevant file paths, specific questions |
| @code-architect | Component to design, existing patterns (from explorer), constraints |
| @code-reviewer | Changed files, project conventions summary, WU acceptance criteria |
| @research-ideation | Research question, constraints, what's already known |
| @unit-test-runner | Target repo, scope (file/module filters), test framework info |
| @reviewer-* | Plan or execution summary, project context |

**Never dump the entire context into a subagent call.** The orchestrator is the context curator.

### Seamless Agent Integration

The orchestrator should prefer Seamless Agent tools over vscode/askQuestions when the extension is available:

| Scenario | Tool | Why |
|----------|------|-----|
| Plan approval | `planReview` | Inline comments on specific sections |
| Mid-execution confirmation | `askUser` | Rich input with file refs |
| UAT walkthrough | `walkthroughReview` | Step-by-step guided review |
| Multiple parallel questions | `vscode/askQuestions` | Batch capability |

**Fallback**: If Seamless Agent tools are unavailable, use vscode/askQuestions for all scenarios.

Recommended instruction for plan review:
```
When presenting a plan for approval, use #planReview and wait for the user's decision.
If the user requests changes, incorporate their inline comments and re-submit via #planReview.
```

### Fast Path (Trivial Requests)

For trivial requests (identified by @o-reframer):

1. Skip planning entirely
2. Delegate directly to @work-unit-runner with:
   - Clear spec (from reframer output)
   - Compressed project context
   - Relevant skill instructions
3. Run get_errors on changed files
4. Report result
5. Enter follow-up loop

No plan pack, no progress tracker. Just execute and report.

### Memory & Documentation

After significant sessions, update project memory:
- Capture durable findings in repo docs or host/session artifacts
- Only for genuinely new insights (not routine work)

Research notes stay exploratory until promoted into canonical docs.

### Error Recovery

- **Subagent failure**: Log, retry once with additional context, then ask user
- **WU exceeds scope**: REPLAN_REQUESTED → minor: update WU, major: back to Phase 2
- **Test failures**: Create fix WU, max 3 attempts, then ask user
- **Plan approval rejected**: Incorporate feedback, re-invoke o-planner
- **Replan budget**: Max 3 replans per session before asking user to confirm continuation

### What This Replaces

| Old Agent | Replacement |
|-----------|-------------|
| executive (v1) | @orchestrator (phases 1-4) |
| executive2 | @orchestrator (phase 3 execution) |
| executive2-planner | @o-planner |
| executive2p5 | @orchestrator (plan-pack execution) |
| executive2p5-planner | @o-planner |
| executive2-fast | @orchestrator trivial fast path |
| task-runner | @work-unit-runner (unchanged) |
| planpack-writer | Merged into @o-planner or kept as-is |

### What Gets Deprecated (Not Deleted Yet)
Executive-era names are historical references only. The shipped surface should point new work to `@orchestrator` or the preserved Elegy workflow.

## Risks

1. **Seamless Agent availability**: Extension may not be installed. Must fall back gracefully to vscode/askQuestions.
2. **Reframer accuracy**: Wrong classification → wrong path. Mitigation: reframer can say "uncertain" and the orchestrator asks the user.
3. **Context window limits**: Orchestrator must stay lean. If it accumulates too much context, quality degrades. Mitigation: delegate aggressively, keep main context for routing only.
4. **Migration**: Users familiar with older executive workflows need clear guidance on switching. Mitigation: keep migration notes explicit and remove stale defaults.
5. **Plan pack format**: Maintaining compatibility for the shared plan-pack contract across preserved workflows.

## Open Questions

1. Should we support Seamless Agent as optional (graceful fallback) or require it?
   - **Recommendation**: Optional with graceful fallback
2. Should @o-planner replace @planpack-writer or delegate to it?
   - **Recommendation**: @o-planner writes plan packs directly (simpler)
3. Should we keep @o-reframer as a separate subagent or inline it in the orchestrator?
   - **Recommendation**: Separate subagent — keeps orchestrator thin and reframer's context clean
4. Should plan packs support a `complexity` field per WU for fast-path routing during execution?
   - **Recommendation**: Yes — `complexity: trivial | standard | complex` on each WU spec
