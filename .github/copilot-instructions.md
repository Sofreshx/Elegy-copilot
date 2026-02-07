# Copilot Instructions (Shared)

These are the lightweight, **global** conventions for using Instruction Engine across repos. Keep this file focused on “where to look / where to write / when to delegate”, and let the agents handle the detailed workflow.

- Prefer small, verifiable changes.

## Completion Gate (Finish End-to-End)
Do not stop execution for trivial issues like :
- Should I write a task for this? (if it’s not clearly out of scope, just write the task)
- File changed since I last read it, should I re-read it? (if the change is relevant to your current work, just re-read it)
- File changed should I revert to the last version I read? (if the change is relevant to your current work, just incorporate the new changes and move forward)
When the user asks you to *do* something (implement/fix/refactor), keep going until it is truly done end-to-end.

Before replying with a “done” / “here’s what I did” message, verify you have:
- Applied the change in the workspace (not just proposed it).
- Checked for new errors (`get_errors`) in touched files.
- Run the narrowest relevant validation (tests/build/task) when available.
- Written a concise recap + what changed + how to validate.

If you need input from the user:
- Ask **one** targeted question.
- Continue executing any non-blocked work in parallel (exploration, drafting, refactors that are safe).
- Provide a plan only when the user explicitly asked for a plan.

Avoid “handoff-only” endings:
- Proceed with the next safe step instead of pausing at “I can do X next, want me to?”.
- Offer optional next steps only after the core request is complete.

## Read First (Project Truth)
Before structural changes, consult in this order:
1. `.instructions/architecture.md`
2. `.instructions/contexts/*.md`
3. Repo docs (`README.md`, `docs/`, `documentation/`, design notes)

## Context & Memory (Durable)
- Use `.instructions/contexts/*.md` as the durable project memory.
- Record architecture decisions, constraints, recurring gotchas, and operational notes.
- Keep entries concise and structured; prune stale details when superseded.
- If contexts grow too large, use `@context-curator` to condense them without losing critical facts.

## Workspace Organization (Where Things Go)
- **Engine (shared)**: `instruction-engine/.github/` (agents + templates), `instruction-engine/..github/skills` (reference skills/docs)
- **Project (per-repo)**: `.instructions/` (tasks, architecture, context/memory)
- **Local output**: `.instructions-output/` (generated reports/logs; keep developer-local)

## Tasks (Durable Tracking)
- Use `.instructions/tasks/` when work needs a durable log (multi-step, ambiguous, or likely to be revisited).
- Prefer `@addtodo` to turn a pile of notes into proper task files.
- When asked to clean up, archive completed tasks to `.instructions/tasks.archive/` and append a short recap to `.instructions/tasks.history.md`.
- Never write task files into the `instruction-engine` repo; tasks belong in the target repo that is using Instruction Engine.

## Delegation (Use Subagents)
Use subagents to keep work high-signal and consistent. Prefer only the ones that clearly apply:
- Core: `@debugger`, `@code-explorer`, `@code-reviewer`, `@unit-test-runner`, `@integration-test-runner`.
- Testing exec: `@testing-executive` for coverage scans + validation runs.
- Issue audit exec: `@issue-audit-executive` for code smell, security, and stack consistency scans.
- Tasking: `@addtodo` for task files; `@executive2-planner` → `@executive2` for durable, task-graph execution (task groups can run in isolation).
- Context: `@context-curator` to condense and refresh `.instructions/contexts/*.md` when they get large.
- UI/UX: `@ui-ux` for iterative client-side visual changes; it relies heavily on `vscode/askQuestions`.
- Use other agents when their specialty is directly relevant.

Subagents must NOT call other subagents; only top-level orchestrators should delegate work.

Use `vscode/askQuestions` for ambiguous or iterative requests, especially UI/UX work, to keep direction aligned.


## Skills (Default to Skills)
If a task maps to a known domain, treat skills as the default path:
- **Always** load the relevant `SKILL.md` before making changes in that domain.
- Prefer skill-specific guidance over generic judgment.
- If multiple skills apply, load the primary one first, then the supporting ones.

## Safety
- Do destructive scaffolding or large deletions only with an explicit user ask.
- Record recurring gotchas or major informations in `.instructions/contexts/*.md`, to a matching file if possible, otherwise create a new one with a clear name, those files should be concise? 

## Testing
- Run the narrowest relevant tests after changes.
- When adding features or fixing bugs, add relevant unit/integration tests.
- **Unit test execution**: Use `@unit-test-runner` (timeouts, non-interactive mode, safe flags).
- **Integration test execution**: Use `@integration-test-runner` only when explicitly requested.
- **Integration test authoring**: Prefer Alba (`alba-integration-tests`).
- **Executive2**: Ask the user before running long E2E/integration tests and log declines to `.instructions/testing/skipped-validation.md`.
- **Segment large test suites** into smaller batches (e.g., by test class filter).