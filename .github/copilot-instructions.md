# Copilot Instructions (Shared)

These are the lightweight, **global** conventions for using Instruction Engine across repos. Keep this file focused on “where to look / where to write / when to delegate”, and let the agents handle the detailed workflow.

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime. Treat
this repo-local file as a routing aid; durable project policy lives under
`docs/system/**`.

- Prefer small, verifiable changes.

- never use the terminal tool with background: true
- NEVER change branches while working unless explicitly asked to do so by the user.
- Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate;
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions; Do not create ADRs for ordinary local implementation choices.

## CRITICAL: run_in_terminal MUST NEVER USE isBackground=true

** NEVER DO THIS:**
```
run_in_terminal(command: "make build", isBackground: true)  # WRONG! Causes silent failures
run_in_terminal(command: "git commit", isBackground: true)   # WRONG! Command gets cancelled
```
### ALWAYS USE vscode/askQuestions
When you need clarification from the user, use `vscode/askQuestions` to ask a single, targeted question through the interactive tool instead of falling back to a plain-text end-of-plan question. This keeps the interaction focused and allows you to continue working on non-blocked tasks in parallel, so you don't have to stop execution for potentially trivial issues.

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
- For builds, tests, servers, and health checks, ALWAYS set a non-zero timeout; `timeout: 0` is forbidden
- NEVER run watch, interactive, or debug test modes through agent tooling
- If unsure, default to `false`

## Core Guardrails Backstop
- The `core-guardrails` skill mirrors these non-negotiable execution rules.
- If repo-level instructions are customized, keep this safety set intact by loading `core-guardrails` before tool execution.

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
- Ask **one** targeted question via `vscode/askQuestions`.
- Continue executing any non-blocked work in parallel (exploration, drafting, refactors that are safe).
- Provide a plan only when the user explicitly asked for a plan.

Avoid “handoff-only” endings:
- Proceed with the next safe step instead of pausing at “I can do X next, want me to?”.
- Offer optional next steps only after the core request is complete.

## Read First (Project Truth)
For repo-rule or workflow decisions, consult in this order:
1. `docs/system/index.md`, then the closest MOC, then the smallest relevant canonical node in `docs/system/**`
2. the nearest applicable `guidelines.md`
3. supporting repo docs (`README.md`, `docs/`, `documentation/`, design notes)
4. legacy `.instructions/architecture.md` and `.instructions/contexts/*.md` only when the repo explicitly opts in

## Documentation Discovery Protocol
When task decisions depend on repository docs, follow this route first:
1. Open `docs/system/index.md`.
2. Choose the closest MOC in `docs/system/mocs/*.md`.
3. Follow that MOC to the minimal set of canonical nodes in `docs/system/**`.
4. Expand only when needed.

Use `guidelines.md` and `README.md` only as lighter local overlays after the canonical route is loaded.
If those surfaces conflict with `docs/system/**`, follow `docs/system/**` and surface the drift.

For instruction-engine repo rules and conventions, use this file as a routing aid, not as the final
authority surface:
- `docs/system/**` is authoritative for repo rules
- `.github/*`, prompts, and repeated repo patterns are secondary unless canonical docs explicitly
  promote them
- before write-capable work, load the smallest relevant canonical `docs/system/**` node yourself
  instead of relying only on this file or an upstream summary
- when canonical bootstrap was required, make the canonical `docs/system/**` sources you actually
  loaded observable in your execution or review output
- if you cannot identify a relevant canonical node or you find a material docs contradiction, stop
  and surface it instead of treating prompt text or local patterns as enough authority

Instruction Engine / Elegy Copilot repo map:
- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into `~/.copilot`.
- `codex-assets/`, `opencode-assets/`, and `antigravity-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.
- For spec-driven work, follow `docs/system/spec-driven-development.md`; durable specs live at `specs/<spec-slug>/spec.md` with optional `specs/index.md`, and the repo-local validator is `node scripts/validate-specs.js <spec-root>`.

Precedence:
- Canonical decisions live in `docs/system/**`.
- Research and exploratory inputs live in `docs/research/**`.
- If they conflict, follow `docs/system/**` and treat research as non-canonical.

## Context & Memory (Durable)
- Prefer host/session artifacts (Copilot session logs, dashboard) as durable memory.
- If a repo still uses `.instructions/contexts/*.md`, treat it as legacy durable memory.
- Record architecture decisions, constraints, recurring gotchas, and operational notes.
- Keep entries concise and structured; prune stale details when superseded.
- If contexts grow too large, condense them manually (context-curator removed).

## Workspace Organization (Where Things Go)
- **Engine (shared)**: `instruction-engine/engine-assets/` (agents + skills + prompts), `instruction-engine/.github/templates` (templates)
- **Project (per-repo)**: repo docs and code (avoid repo-local `.instructions/*` unless explicitly opted-in)
- **Local output**: prefer central host state (e.g., VS Code repo-state/session-state) over repo-local `.instructions-output/`

## Documentation & Output Routing
Route written output to the correct location based on content type:
- **Research & exploration** → return in-chat by default; only write repo files when explicitly requested.
- **Architecture decisions & constraints** → `docs/` / `documentation/` (or legacy `.instructions/contexts/` if the repo still uses it).
- **Plan packs** → return in-chat by default; the host/dashboard persists them outside the repo.
- **User-facing documentation** → `docs/` or `README.md` — end-user and developer guides.
- **Generated reports & logs** → avoid `.instructions-output/`; prefer host/session artifacts.
- **Implementation friction log** → append concise recurring codebase pain points to `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md`.
- **Task tracking** → avoid repo-local task systems; prefer orchestrator + host persistence.

Key distinctions:
- **Analysis ≠ Documentation**: analysis goes to `docs/research/**`; only settled decisions get promoted to `docs/system/**`.
- **Ideas ≠ Decisions**: raw ideas stay in research notes. Promote to canonical docs only when ratified.
- **Internal context ≠ User docs**: canonical/internal system context goes to `docs/system/**`; user-facing docs go to `docs/` or `README.md`.

Legacy note:
- If a repository explicitly opts into `.instructions/*`, treat it as a legacy overlay and keep `docs/system/**` as canonical unless repo policy says otherwise.

## Tasks (Durable Tracking)
- Avoid repo-local task tracking by default; prefer `@orchestrator` + host persistence.
- Prefer `@orchestrator` to convert notes into a concrete plan and execute it.
- If a repo still uses `.instructions/tasks/`, treat it as legacy and keep cleanup consistent.
- Never write task files into the `instruction-engine` repo unless the task is specifically about Instruction Engine itself; tasks otherwise belong in the target repo that is using Instruction Engine.

## Delegation (Use Subagents)
Use subagents to keep work high-signal and consistent. Prefer only the ones that clearly apply:
- **Orchestrator**: `@orchestrator` (VS Code) or `@orchestrator-cli` (Copilot CLI — uses native Rubber Duck for plan review). Single entry point for complex work.
- **Search/Execute (preferred capability routing)**: use `@search` to resolve the smallest relevant capability, then `@execute` to turn it into a compact downstream brief before loading heavy context.
- Core: `@code-explorer`, `@code-reviewer`, `@test-runner`.
- Implementation: `@impl` (unified — accepts `kind: business | infra`).
- Tasking: use `@orchestrator` to plan and execute; avoid creating repo-local task files.
- Planning: `@orchestrator` (preferred) for all planning workflows.
- Context: keep durable notes in repo docs or host artifacts (context-curator removed).
- UI/UX: route through `@orchestrator` (it will delegate to code-focused leaf agents as needed).
- Runtime: start/stop local services using repo-documented commands or VS Code tasks.
- Use other agents when their specialty is directly relevant.

> **Removal notice**: legacy executive agents (`@executive2`, `@executive2p5`, etc.) have been removed. Use `@orchestrator`.

Nested delegation is allowed only for named approved coordinator agents with explicit frontmatter
allowlists. All other agents remain leaf-only in V1, write-capable implementation lanes and
reviewer lanes remain leaf-only, coordinator-to-coordinator chains are forbidden, and planning must
fall back to the legacy-depth-1 direct orchestrator -> `@o-planner` path when nested delegation is
unavailable or disabled.

Use `vscode/askQuestions` for ambiguous or iterative requests, especially UI/UX work, to keep direction aligned.

## User Interaction (askQuestions)
Use `vscode/askQuestions` when:
- Requirements are ambiguous and no safe default exists.
- A decision meaningfully affects the outcome (architecture choice, scope boundary, tech selection).
- Before running long E2E checks or unusually heavy/destructive validation where timing expectations matter.
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
- A few transversal skills are always loaded in `~/.copilot/skills/`: `core-guardrails`, `skill-discovery`, `implementation-friction`, `stack-detector`, `project-guidelines`.
- **Most domain skills live in `~/.copilot/skills-vault/`** and are NOT loaded by default (saves tokens).
- Use the staged routing model by default:
	1. `@search` resolves the smallest relevant capability.
	2. `@execute` extracts the minimum constraints and steps needed downstream.
	3. Only load the resolved on-demand skill when the task truly needs domain-specific guidance.
- To find the right skill: use the `skill-discovery` skill's keyword map, or run `stack-detector` for project-wide detection.
- To load an on-demand skill: `read_file("~/.copilot/skills-vault/{skill-name}/SKILL.md")`.
- Prefer skill-specific guidance over generic judgment.
- If multiple skills apply, load the primary one first, then the supporting ones.

## Implementation Friction Capture
- Constructive complaints about hard-to-work-with code are allowed when they help delivery.
- When recurring implementation friction is detected (shaky patterns, dead code, brittle design, repeated workaround), load the `implementation-friction` skill.
- Log only concise entries, then continue implementation; avoid deep refactor detours unless explicitly requested.

## Safety
- Do destructive scaffolding or large deletions only with an explicit user ask.
- Record recurring gotchas or major information in repo docs or host/session artifacts. When persisting in the repo, prefer `docs/system/**` for canonical guidance or `~/.copilot/backlogs/{repo-name}/issues/` for operational notes.

## Secrets & Config
- Never store secrets in `.env*` files or repo files. Use GitHub Secrets for CI and local secret stores (OS keychain, dotnet user-secrets, or environment variables set outside the repo).
- `.env*` files are allowed only for non-secret configuration. If unsure, treat the value as a secret and keep it out of `.env*`.

## Hooks (Deterministic Automation)
- Hooks are opt-in. Keep `.github/hooks/` empty unless you are intentionally running automation.
- Use `.github/hooks/*.json` to run deterministic hooks (logging, infra start/stop, policy gates).
- Write hook logs to `.instructions-output/hooks/*.jsonl`.
- Keep hooks fast (under 5 seconds) and never log secrets.

## Testing
- Run the narrowest relevant tests after changes.
- When adding features or fixing bugs, add relevant unit/integration tests.
- **Test execution**: Use `@test-runner` (timeouts, non-interactive mode, safe flags, and lane-owned unit/integration/browser selection).
- Generic implementation lanes may request test scope, but they should not execute test commands directly.
- **Integration test authoring**: Prefer Alba (`alba-integration-tests`).
- **Long E2E/integration runs**: Ask the user before running them and capture any decline in chat or host/session artifacts when a durable note is needed.
- **Segment large test suites** into smaller batches (e.g., by test class filter).
- Treat timeout, stalled-output, and inconclusive validation as results to handle, not reasons to keep waiting for terminal output.

## Temp File Safety Controls
<a id="temp-file-safety-controls-v1"></a>

When generating or working with temporary files for LLM workflows, follow these mandatory controls:

### TMP-CTRL-001: Use sanctioned temp directories
Always write temporary files to one of these locations:
- `${REPO_ROOT}/.tmp/llm-input/` — input staging
- `${REPO_ROOT}/.tmp/llm-output/` — output collection
- `${REPO_ROOT}/.tmp/llm-work/` — scratch/working files
- `${TMPDIR:-/tmp}/llm-session-<id>/` — OS temp dir (ephemeral)
- OS temp dir via `mktemp -d` or platform equivalent

### TMP-CTRL-002: Never write to null devices or pseudo-file sinks
The following targets are **strictly prohibited** for any file write, redirect, or output:
- **Null devices**: `/dev/null`, `NUL`, `NUL:`
- **Pseudo-devices**: `/dev/zero`, `/dev/random`, `/dev/urandom`
- **Kernel pseudo-filesystems**: `/proc/*`, `/sys/*`
- **Windows reserved device names**: `CON`, `PRN`, `AUX`, `COM1`..`COM9`, `LPT1`..`LPT9`

**Good** (do this):
```
echo "output" > ${REPO_ROOT}/.tmp/llm-work/scratch.txt
echo "log" > ${TMPDIR:-/tmp}/llm-session-abc123/output.log
mktemp -d  # create a proper temp directory
```

**Bad** (never do this):
```
> /dev/null
Out-File NUL
echo "" > /proc/self/...
command 2>/dev/null  # suppresses errors unsafely
```

### TMP-CTRL-003: Ensure .gitignore coverage
All sanctioned temp roots (`/.tmp/llm-input/`, `/.tmp/llm-output/`, `/.tmp/llm-work/`) must be listed in the repo's `.gitignore`.

### TMP-CTRL-004: Clean up after use
Temporary files should be removed after the workflow completes. Do not leave stale temp files across sessions.

### TMP-CTRL-005: Never store secrets in temp files
Temp files must never contain API keys, tokens, passwords, or other secrets. Use environment variables or OS keychains instead.

### TMP-CTRL-006: Prefer real files over streams for auditable workflows
When an audit trail is needed, write to a real file in a sanctioned temp directory rather than piping through memory-only streams.

## Defensive Tool Use (Hang & Error Prevention)

### TOOL-SAFE-001: Verify directories before listing
Before calling `list_dir` on paths that may not exist (build output, test results, artifact directories), verify the path exists first. Do not assume output directories are present — they depend on prior build/test steps having run.

### TOOL-SAFE-002: Prefer smaller patches for large files
When editing files over 200 lines of changes, use multiple smaller targeted edits instead of one large patch. Re-read the file immediately before editing to ensure context lines match. If a patch fails with "Invalid context", re-read the target file and retry with fresh context.

### TOOL-SAFE-003: Keep session-state files lean
Plan files in `session-state/` should stay under 500 lines. When a plan file grows large, archive completed sections to a separate file to reduce patch conflict risk.

### TOOL-SAFE-004: Never launch long-running processes without timeouts
When spawning child processes (servers, builds, tests), always configure a timeout or deadline. Never rely on a process exiting on its own — always have a kill path if it exceeds the timeout budget. This applies to both direct terminal commands and programmatic process spawning.

### TOOL-SAFE-005: Desktop host and server launches
When launching desktop hosts, packaged desktop apps, or dev servers that assign ports and wait for health checks:
- Ensure health check loops have bounded retry counts (not infinite).
- Always configure a total timeout for the startup sequence.
- If a health check fails after the retry budget, kill the spawned process and report the failure — do not leave ghost processes.
