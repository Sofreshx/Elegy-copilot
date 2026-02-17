# Copilot Instructions (Shared)

These are the lightweight, **global** conventions for using Instruction Engine across repos. Keep this file focused on “where to look / where to write / when to delegate”, and let the agents handle the detailed workflow.

- Prefer small, verifiable changes.

- never use the terminal tool with background: true

## CRITICAL: run_in_terminal MUST NEVER USE isBackground=true

** NEVER DO THIS:**
```
run_in_terminal(command: "make build", isBackground: true)  # WRONG! Causes silent failures
run_in_terminal(command: "git commit", isBackground: true)   # WRONG! Command gets cancelled
```

** ALWAYS DO THIS:**
```
run_in_terminal(command: "make build", isBackground: false)  # CORRECT
run_in_terminal(command: "git commit", isBackground: false)  # CORRECT
```

**WHY:**
- `isBackground=true` causes commands to be cancelled/interrupted
- You won't see output or know if command succeeded
- Git commits, builds, and all other commands REQUIRE `isBackground=false`
- This is a HARD REQUIREMENT - violations cause session failure

**THE RULE:**
- ALWAYS set `isBackground: false` for ALL commands
- NEVER use `isBackground: true` for ANY command
- If unsure, default to `false`

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
- **Engine (shared)**: `instruction-engine/.github/` (agents + templates), `instruction-engine/.github/skills` (reference skills/docs)
- **Project (per-repo)**: `.instructions/` (tasks, architecture, context/memory)
- **Local output**: `.instructions-output/` (generated reports/logs; keep developer-local)

## Documentation & Output Routing
Route written output to the correct location based on content type:
- **Research & exploration** → `.instructions/research/<slug>.md` — temporary, exploratory notes. Use for brainstorming, option analysis, and investigation.
- **Architecture decisions & constraints** → `.instructions/contexts/<topic>.md` — durable, curated. Only promote findings here when they represent settled decisions or confirmed constraints.
- **Plan packs** → `.instructions/artefacts/x-PLANPACK-*.md` — execution artefacts for Executive2.5.
- **User-facing documentation** → `docs/` or `README.md` — end-user and developer guides.
- **Generated reports & logs** → `.instructions-output/` — local, ephemeral. CI logs, audit reports, hook output.
- **Task tracking** → `.instructions/tasks/` — durable task files (Executive2 only, NOT Executive2.5).

Key distinctions:
- **Analysis ≠ Documentation**: analysis goes to `.instructions/research/`; only settled decisions get promoted to `.instructions/contexts/`.
- **Ideas ≠ Decisions**: raw ideas stay in research notes. Promote to contexts only when ratified.
- **Internal context ≠ User docs**: agent-facing context goes to `.instructions/contexts/`; user-facing docs go to `docs/`.

## Tasks (Durable Tracking)
- Use `.instructions/tasks/` when work needs a durable log (multi-step, ambiguous, or likely to be revisited).
- Prefer `@addtodo` to turn a pile of notes into proper task files.
- When asked to clean up, archive completed tasks to `.instructions/tasks.archive/` and append a short recap to `.instructions/tasks.history.md`.
- Never write task files into the `instruction-engine` repo unless the task is specifically about Instruction Engine itself; tasks otherwise belong in the target repo that is using Instruction Engine.

## Delegation (Use Subagents)
Use subagents to keep work high-signal and consistent. Prefer only the ones that clearly apply:
- **Orchestrator (recommended)**: `@orchestrator` — single entry point for all complex work. Routes by complexity (trivial/standard/complex), delegates to specialized subagents. Replaces all executive variants.
- Core: `@debugger`, `@code-explorer`, `@code-reviewer`, `@unit-test-runner`, `@integration-test-runner`.
- Testing exec: `@testing-executive` for coverage scans + validation runs.
- Issue audit exec: `@issue-audit-executive` for code smell, security, and stack consistency scans.
- Tasking: `@addtodo` for task files; `@executive2-planner` → `@executive2` for durable, task-graph execution (task groups can run in isolation).
- Planning: `@orchestrator` (preferred) or `@executive2p5-planner` → `@executive2p5` for plan-pack workflows.
- Context: `@context-curator` to condense and refresh `.instructions/contexts/*.md` when they get large.
- UI/UX: `@ui-ux` for iterative client-side visual changes; it relies heavily on `vscode/askQuestions`.
- Runtime: `@app-runtime-manager` to start/stop local services for integration/E2E/UI exploration.
- Use other agents when their specialty is directly relevant.

> **Deprecation notice**: `@executive`, `@executive2`, `@executive2p5`, `@executive3`, and `@executive2-fast` are deprecated. Use `@orchestrator` instead. The old agents remain functional but are no longer recommended.

Subagents must NOT call other subagents; only top-level orchestrators should delegate work.

Use `vscode/askQuestions` for ambiguous or iterative requests, especially UI/UX work, to keep direction aligned.

## User Interaction (askQuestions)
Use `vscode/askQuestions` when:
- Requirements are ambiguous and no safe default exists.
- A decision meaningfully affects the outcome (architecture choice, scope boundary, tech selection).
- Before running integration/E2E tests or destructive operations.
- Iterative UI/UX work where visual feedback is needed.

Do NOT use askQuestions for:
- Trivial decisions with an obvious best answer — just proceed.
- Asking permission to continue or abort — keep working.
- Status updates — use the todo list instead.
- Confirming something you can reasonably decide yourself.

When asking:
- Batch related questions (max 4, 2-6 options each).
- Propose a sensible default (mark as `recommended`) with brief justification.
- Continue non-blocked work while awaiting answers.

Note: The "Completion Gate" rule ("ask one targeted question") applies to general mid-execution pauses. When using the `vscode/askQuestions` tool specifically, batching up to 4 related questions in a single call is preferred.

## Skills (Default to Skills)
If a task maps to a known domain, treat skills as the default path:
- **Always** load the relevant `SKILL.md` before making changes in that domain.
- Prefer skill-specific guidance over generic judgment.
- If multiple skills apply, load the primary one first, then the supporting ones.

## Safety
- Do destructive scaffolding or large deletions only with an explicit user ask.
- Record recurring gotchas or major informations in `.instructions/contexts/*.md`, to a matching file if possible, otherwise create a new one with a clear name, those files should be concise? 

## Secrets & Config
- Never store secrets in `.env*` files or repo files. Use GitHub Secrets for CI and local secret stores (OS keychain, dotnet user-secrets, or environment variables set outside the repo).
- `.env*` files are allowed only for non-secret configuration. If unsure, treat the value as a secret and keep it out of `.env*`.

## Hooks (Deterministic Automation)
- Hooks are opt-in. Keep `.github/hooks/` empty unless you are intentionally running automation like Executive3.
- Use `.github/hooks/*.json` to run deterministic hooks (logging, infra start/stop, policy gates).
- Write hook logs to `.instructions-output/hooks/*.jsonl`.
- Keep hooks fast (under 5 seconds) and never log secrets.

## Testing
- Run the narrowest relevant tests after changes.
- When adding features or fixing bugs, add relevant unit/integration tests.
- **Unit test execution**: Use `@unit-test-runner` (timeouts, non-interactive mode, safe flags).
- **Integration test execution**: Use `@integration-test-runner` only when explicitly requested.
- **Integration test authoring**: Prefer Alba (`alba-integration-tests`).
- **Executive2**: Ask the user before running long E2E/integration tests and log declines to `.instructions/testing/skipped-validation.md`.
- **Segment large test suites** into smaller batches (e.g., by test class filter).