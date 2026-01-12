# Copilot Instructions (Shared)

These are the lightweight, **global** conventions for using Instruction Engine across repos. Keep this file focused on “where to look / where to write / when to delegate”, and let the agents handle the detailed workflow.

## Defaults
- Treat the **current repo** as the source of truth. Don’t override local conventions with engine conventions.
- Prefer small, verifiable changes.
- If a task spans multiple steps or sessions, capture decisions in `.instructions/` when present.

## Read First (Project Truth)
Before structural changes, consult in this order:
1. `.instructions/architecture.md`
2. `.instructions/contexts/*.md` (especially `project.memory.md`)
3. Repo docs (`README.md`, `docs/`, `documentation/`, design notes)

## Workspace Organization (Where Things Go)
- **Engine (shared)**: `instruction-engine/.github/` (agents + templates), `instruction-engine/..github/skills` (reference skills/docs)
- **Project (per-repo)**: `.instructions/` (tasks, architecture, context/memory)
- **Local output**: `.instructions-output/` (generated reports/logs; keep developer-local)

## Tasks (Durable Tracking)
- Use `.instructions/tasks/` when work needs a durable log (multi-step, ambiguous, or likely to be revisited).
- Prefer `@addtodo` to turn a pile of notes into proper task files.
- When asked to clean up, archive completed tasks to `.instructions/tasks.archive/` and append a short recap to `.instructions/tasks.history.md`.

## Delegation (Use Subagents)
Use subagents to keep work high-signal and consistent:
- `@debugger` for failures, stack traces, and non-obvious bugs.
- `@code-explorer` when you need to map an unfamiliar codebase.
- `@code-reviewer` for a focused quality/security review.
- `@merger` for merge conflicts and migrations.
- `@test-executive` to plan/coordinate testing; `@unit-test-gen` / `@integration-test-gen` to generate tests.
- `@executive2-planner` + `@executive2` for larger multi-phase features.


## Skills (Use Judgement)
In most cases, you don’t need to explicitly “load skills” manually.
Only consult skill docs when you’re unsure, the change is high-risk, or the repo clearly declares a preferred way of doing something.

## Safety
- Don’t do destructive scaffolding or large deletions without an explicit user ask.
- When you discover a recurring gotcha, record it in `.instructions/contexts/project.memory.md`.

## Testing
- Always run existing tests after changes.
- When adding features or fixing bugs, add relevant unit/integration tests.