# Orchestrator Research Analysis

## Date
2026-02-17

## Objective
Analyze orchestration patterns across our executive versions and external systems to design a next-generation "Orchestrator" agent that consolidates the best patterns.

## Our Executive Evolution

### Executive (v1) — Phase-Based Feature Planner
- 7-phase workflow: Discovery → Exploration → Clarification → Architecture → Implementation → Review → Summary
- Delegates to code-explorer, code-architect, code-reviewer
- Manual, sequential, no persistence
- **Strength**: Strong exploration-before-action discipline
- **Weakness**: No state persistence, no parallelism, no automated testing integration

### Executive2 — Task-Graph Orchestrator
- Split into planner + executor (executive2-planner → executive2)
- Persistent state in `.instructions/tasks/*` + plan artefact + progress tracker
- Delegated execution via task-runner
- Cross-model review
- **Strength**: Durable task graph, proper separation of planning vs execution
- **Weakness**: Heavy file system footprint (many task files), complex task-creator subagent, rigid task format

### Executive2.5 — Plan-Pack Workflow
- Replaced task files with unified plan pack (2 files: plan pack + progress tracker)
- Work units instead of tasks, grouped with dependencies
- Session-scoped (SESSION_ID prevents collisions)
- Progressive persistence (skeleton → refined)
- work-unit-runner instead of task-runner  
- **Strength**: Simpler state (2 files vs many), session isolation, progressive persistence
- **Weakness**: Still file-based state, plan pack can be hard to modify mid-execution, no fast path for trivial work

### Executive3 — SQLite-Backed Unified Orchestrator
- Single entry point (user only invokes executive3)
- SQLite database for all state (sessions, tasks, plans, execution logs, context)
- E3 CLI for database operations
- 6-phase lifecycle: Bootstrap → Planning → Execution → Testing → Review → Follow-Up Loop
- Request classification (feature/bugfix/refactor/testing/review/research/ad-hoc)
- Context curator role (passes only relevant context to each subagent)
- Smart-context opt-in (Phase B)
- **Strength**: Robust state, session continuity, context curation, follow-up loop (never stops)
- **Weakness**: Complex (SQLite + CLI + many commands), heavy bootstrap, DB reliability concerns, overkill for small tasks

### Executive2-Fast — No-Persistence Variant  
- Quick execution with no persistent state
- Can hand off to planner if scope expands
- Optional handover artefact for session continuity
- **Strength**: Zero overhead for simple tasks
- **Weakness**: No memory, no recovery if interrupted

## External Systems Analysis

### GSD (get-shit-done) — 15.1k stars
**Architecture**: Command-driven phase system (new-project → discuss → plan → execute → verify → complete)
**Key Innovations**:
1. **Context rot prevention**: Fresh 200k context per executor subagent — main window stays lean
2. **Wave-based parallelization**: Dependency-aware parallel execution within waves
3. **Discuss phase**: Captures user preferences BEFORE planning (gray area identification)
4. **Model profiles**: quality/balanced/budget tiers controlling which model each agent uses
5. **Session pause/resume**: Formal handoff documents for multi-session work
6. **Health check**: `gsd:health --repair` validates state integrity
7. **Quick mode**: Fast path for ad-hoc tasks that skip research/verification
**Weaknesses**: Claude Code specific, no code review step, YOLO mode security concern

### Copilot Orchestra — 684 stars
**Architecture**: 4-agent linear pipeline (Conductor → Planning → Implement → Code Review)
**Key Innovations**:
1. **TDD enforcement**: Implementation subagent MUST write failing tests first
2. **3-status code review**: APPROVED/NEEDS_REVISION/FAILED with distinct handling paths
3. **Cost-optimized model selection**: Haiku for implementation (cheap), Sonnet for review (capable)
4. **Mandatory pause points**: Plan approval + phase commits keep user in control
5. **Phase completion docs**: Audit trail for every phase
**Weaknesses**: Sequential only, no parallelism, heavy user involvement, no research step

### Wrapzii Orchestration
**Architecture**: 4-agent hub-and-spoke (Orchestrator → Planner/Designer/Coder/FastCoder)
**Key Innovations**:
1. **FastCoder/Coder task routing**: Route by complexity — trivial tasks get fast path
2. **"Delegate WHAT not HOW"**: Orchestrator describes acceptance criteria, not implementation steps
3. **Cross-model strategy**: Different AI providers for different roles
4. **Prompt templates**: Literal delegation templates reduce orchestrator improvisation
5. **"Always end prompts with questions"**: Forces subagents to surface uncertainties
6. **Parallel FastCoder + Coder**: Run simple and complex tasks simultaneously
**Weaknesses**: No session continuity, limited state management, repo-specific constraints baked in

### Seamless Agent (VS Code Extension) — 890 installs
**Tools provided**:
1. **`planReview`**: Dedicated review panel with inline comments on specific sections → returns structured { status, requiredRevisions }. SIGNIFICANTLY better than vscode/askQuestions for plan approval.
2. **`askUser`**: Rich notification + input panel — supports images, file references, attachments
3. **`walkthroughReview`**: Step-by-step walkthrough panel with comment support for UAT
4. **`approvePlan`**: Deprecated alias for planReview
**Strengths**: Structured feedback (not freetext), history timeline, MIT license
**Weaknesses**: Only 890 installs (stability concern), no batch question capability

## Cross-Cutting Patterns (Consensus)

| Pattern | GSD | Orchestra | Wrapzii | Our E2.5 | Our E3 |
|---------|-----|-----------|---------|----------|--------|
| Orchestrator never codes | ✓ | ✓ | ✓ | ✓ | ✓ |
| Plan approval before execution | ✓ | ✓ | ✓ | ✓ | ✓ |
| Subagents get focused context | ✓ | ✓ | ✓ | partial | ✓ |
| File-based state | ✓ | ✓ | ✓ | ✓ | DB |
| Request classification | Quick mode | - | FastCoder split | - | ✓ |
| Parallelization | Waves | None | Coder+FastCoder | WU Groups | Policy-based |
| Session continuity | pause/resume | Manual | None | Progress tracker | SQLite |
| TDD enforcement | No | Strict | No | No | No |
| Code review gate | No | Per-phase | No | Optional | Per-task |

## Key Conclusions

### What Works
1. **Single entry point** — user shouldn't need to choose between orchestrators (E3 philosophy)
2. **Request classification** — route by complexity and type before doing anything (E3 + GSD Quick mode + Wrapzii FastCoder)
3. **Context curation** — pass ONLY relevant context to each subagent (E3's strongest principle)
4. **Progressive persistence** — persist early/often, refine later (E2.5 skeleton → refined)
5. **Plan approval with structured feedback** — Seamless Agent's planReview is the gold standard
6. **Discuss/clarify before planning** — GSD's discuss phase reduces misunderstanding
7. **Fast path for trivial work** — skip full planning overhead for small tasks
8. **Follow-up loop** — never auto-stop, let user choose next action (E3)

### What Doesn't Work
1. **SQLite for state** — adds complexity (CLI, bootstrap, DB reliability) without proportional benefit for VS Code agent workflows
2. **Heavy file systems** — many task files (E2) or elaborate hierarchies (GSD) create noise
3. **Rigid lifecycle** — forcing every request through 6 phases even for a typo fix
4. **No subagent chaining** — correct principle but needs clear enforcement
5. **Context window management** — VS Code agents can't spawn fresh context windows like Claude Code, so we must be smarter about what we pass to subagents

### What We Should Build
A unified orchestrator that:
- Is the ONLY agent the user invokes
- Routes requests by type and complexity
- Delegates ALL leaf work to specialized subagents
- Manages state via simple plan-pack files (not SQLite, not task files)
- Uses Seamless Agent tools for rich user interaction
- Preserves context by being a thin coordinator (not doing work itself)
- Supports fast path for trivial requests
- Has a follow-up loop for continuity
- Integrates web search, code search, research as first-class subagent calls
