# Copilot Instructions — Harness Appendix

Composed at install time with the shared baseline.

This file is intended to be installed to `~/.elegy/copilot-instructions.md`.

These instructions are optimized for **Copilot CLI** stock modes (**/plan** and **/fleet**)
while remaining compatible with VS Code Copilot Chat.
Assume **both** user-level and repo-level instructions apply; conflicts can be non-deterministic,
so explicitly reconcile them (see "Conflicts" below).
For repo-specific policy, treat these instructions as a thin routing surface and defer to
canonical docs in `docs/system/**`.

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime. This file
is the global Copilot baseline installed to `~/.elegy/copilot-instructions.md`,
so it should route to canonical sources instead of carrying target-repo policy.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

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

## /plan (required workflow)
When I use **/plan** OR custom plan agent, you MUST:
1. Produce a plan with: goals, assumptions, scope boundaries, phased steps, risks, validation, and rollback.
2. **In Copilot CLI**: rely on Rubber Duck (native cross-model review) to automatically challenge the plan. No manual reviewer delegation needed.
3. **In VS Code / other environments**: request review from the active reviewer lane, normally `@code-reviewer`, or the host's native plan-review affordance when available. Revise until the reviewer approves or blocks with a concrete issue.
4. Only after review passes: summarize the approved plan and proceed to execution (unless I asked for plan-only).
5. When work reaches closure, assess the plan's high-level goals, route unresolved non-active goals to `~/.elegy/backlogs/{repo-name}/issues/unresolved-goals.md`, and produce the final requested-vs-delivered summary.

If a reviewer cannot approve due to missing info, use `vscode/askQuestions` to ask the smallest set of clarifying questions through the interactive tool, then keep refining everything else first.

## /fleet (best practices)
When I use **/fleet**, optimize for parallel throughput without conflicts:
- Split work into **independent workstreams** (by feature slice or by file/area ownership).
- Minimize cross-stream file conflicts by:
  - assigning **exclusive ownership** of files/directories per stream,
  - preferring additive changes and new files over large refactors,
  - avoiding shared "core" files unless explicitly designated as a single-stream responsibility.
- Merge work via **small PR-sized chunks**:
  - keep each chunk reviewable (tight diff, clear purpose),
  - land incremental commits frequently,
  - rebase/resolve conflicts early rather than batching.
- Maintain a short validation step at the end of each chunk: run the narrowest relevant checks, but escalate to integration or browser/E2E validation when policy, risk, or coverage gaps make lower-layer checks insufficient.

## Subagents (speed + context)
- Delegate aggressively for speed:
  - capability discovery and staged context loading → `@search`, then `@execute`
  - exploration/synthesis → `@code-explorer` (or `explore` agent)
  - running builds/tests → route validation through `@test-runner`; it owns unit, integration, and browser/E2E selection, while builds still go through the appropriate execution lane/task agent
  - high-signal review → `@code-reviewer`
  - plan authoring → native `/plan` or the installed `instruction-engine-plan` prompt, plus any needed `askQuestions` clarification
- Keep context lean:
  - quote only the minimum necessary code, paths, and logs,
  - prefer file paths + line ranges over large pastes,
  - keep summaries under ~300 words per workstream unless I ask for depth.

## Using Instruction Engine assets
- A few transversal skills are always loaded (`~/.elegy/skills/`): `core-guardrails`, `skill-discovery`, `roadmap-authoring`, `project-guidelines`.
- **Most domain-specific skills live in the vault** (`~/.elegy/skills-vault/`) and are NOT loaded by default to save tokens.
- The canonical workflow is **search then execute**:
  1. Use `@search` to resolve the smallest relevant capability across docs, agents, and skills.
  2. Use `@execute` to turn the resolved capability into a minimal execution brief.
  3. Only then load or delegate to the downstream specialist agent.
- When domain-specific behavior matters, **discover and load the right skill on demand**:
   1. Match the task domain to a skill name (use the `skill-discovery` skill's keyword map for detection).
   2. Load the full skill: `read_file("~/.elegy/skills-vault/{skill-name}/SKILL.md")`.
   3. Follow the skill's instructions for the current task.
- For GitHub Actions, workflow runs/logs, PR state, issues, commits, branches, or release-download troubleshooting in
  **Copilot CLI**, prefer the built-in read-only `github-mcp-server` tools when available. The UI
  workspace MCP patch flow is for VS Code/workspace sessions, not a prerequisite for the CLI lane.
- If a skill is not found in the vault, it is not installed — proceed with general knowledge.
- See `docs/system/search-execute-workflow.md` for the canonical staged-routing model.
- Prefer canonical documentation in `docs/system/**`; use this file for routing/setup cues, not as a second copy of repo policy.
- Treat `.instructions/*` paths as legacy and use them only when a repository explicitly opts in.

When the current workspace is the Instruction Engine / Elegy Copilot repo:
- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into `~/.elegy`.
- `codex-assets/`, `opencode-assets/`, and `antigravity-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.
- Start repo-rule work at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.
- For spec-driven work, follow `docs/system/spec-driven-development.md`; durable specs live at `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`, and the repo-local validator is `node scripts/validate-specs.js <spec-root>`.

## Implementation Friction Capture
- Constructive complaints about hard-to-work-with code are allowed when they help delivery.
- When recurring implementation friction is detected, capture it briefly in chat or the user-requested tracking surface, then continue delivery without deep side-tracking.

## Conflicts (repo-level + user-level)
- Assume repo-level instructions (e.g. `.github/copilot-instructions.md`) may add constraints.
- If instructions disagree:
  1) follow the **user's explicit request** for the current task,
  2) then apply the **most specific** instructions for the file/area,
  3) and default to the **safer** option for anything involving security, data loss, or destructive actions.
- When in doubt, briefly call out the conflict and the resolution you chose, then proceed.

## Supporting context after canonical bootstrap
- For repo-rule or workflow decisions, start with `docs/system/index.md`, then the closest MOC, then the smallest relevant canonical node in `docs/system/**`.

## Documentation Discovery Protocol
When task decisions depend on repository docs, follow this route first:
1. Open `docs/system/index.md`.
2. Choose the closest MOC in `docs/system/mocs/*.md`.
3. Follow that MOC to the minimal set of canonical nodes in `docs/system/**`.
4. Expand only when needed, and keep downstream briefs pointer-based instead of copying long policy blocks.

If those surfaces conflict with `docs/system/**`, follow `docs/system/**` and surface the drift.

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
