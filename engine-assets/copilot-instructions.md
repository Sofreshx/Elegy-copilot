# Copilot Instructions (CLI-first, VS Code compatible)

This file is intended to be installed to:
`~/.copilot/copilot-instructions.md`

These instructions are optimized for **Copilot CLI** stock modes (**/plan** and **/fleet**) while remaining compatible with VS Code Copilot Chat.
Assume **both** user-level and repo-level instructions apply; conflicts can be non-deterministic, so explicitly reconcile them (see “Conflicts” below).
For repo-specific policy, treat these instructions as a thin routing surface and defer to canonical docs in `docs/system/**`.

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

## Operating rules (global)
- Prefer small, verifiable changes.
- Do **not** change git branches unless explicitly asked.
- Do **not** run terminal commands in background/detached modes for builds/tests/commits.
- If instructions conflict, choose the **safer** interpretation and state what you’re doing.

## /plan (required workflow)
When I use **/plan** OR custom plan agent, you MUST:
1. Produce a plan with: goals, assumptions, scope boundaries, phased steps, risks, validation, and rollback.
2. **In Copilot CLI**: rely on Rubber Duck (native cross-model review) to automatically challenge the plan. No manual reviewer delegation needed.
3. **In VS Code / other environments**: submit the plan for cross-model review by **BOTH** `@reviewer-sonnet-4-6` and `@reviewer-gpt-5-4`. Revise until BOTH respond “APPROVED”.
4. Only after review passes: summarize the approved plan and proceed to execution (unless I asked for plan-only).
5. When work reaches closure, assess the plan's high-level goals, route unresolved non-active goals to `~/.copilot/backlogs/{repo-name}/issues/unresolved-goals.md`, and produce the final requested-vs-delivered summary.

If a reviewer cannot approve due to missing info, use `vscode/askQuestions` to ask the smallest set of clarifying questions through the interactive tool, then keep refining everything else first.

## /fleet (best practices)
When I use **/fleet**, optimize for parallel throughput without conflicts:
- Split work into **independent workstreams** (by feature slice or by file/area ownership).
- Minimize cross-stream file conflicts by:
  - assigning **exclusive ownership** of files/directories per stream,
  - preferring additive changes and new files over large refactors,
  - avoiding shared “core” files unless explicitly designated as a single-stream responsibility.
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
  - plan authoring → `@o-planner` after `@o-reframer` plus any needed `askQuestions` clarification; do not keep a separate `@brief` lane alive
- Keep context lean:
  - quote only the minimum necessary code, paths, and logs,
  - prefer file paths + line ranges over large pastes,
  - keep summaries under ~300 words per workstream unless I ask for depth.

## Using Instruction Engine assets
- A few transversal skills are always installed on the primary path (`~/.copilot/skills/`): `core-guardrails`, `skill-discovery`, `implementation-friction`, `stack-detector`, `project-guidelines`.
- The shared planning/spec/review lane is also installed on that primary path: `rubberduck-plan-review`, `roadmap-planning`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`.
- Most other domain-specific skills remain vault-first in `~/.copilot/skills-vault/` to keep the installed scan path lean.
- The canonical workflow is **search then execute**:
  1. Use `@search` to resolve the smallest relevant capability across docs, agents, and skills.
  2. Use `@execute` to turn the resolved capability into a minimal execution brief.
  3. Only then load or delegate to the downstream specialist agent.
- Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate instead of copying full policy blocks downstream.
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions; do not create ADRs for routine local implementation choices.
- When domain-specific behavior matters, **discover and load the right skill when the current step needs it**:
  1. Match the task domain to a skill name (use the `skill-discovery` skill's keyword map or run `stack-detector` for project-wide detection).
  2. Load the full skill from its installed path: `~/.copilot/skills/{skill-name}/SKILL.md` for always-installed skills, or `~/.copilot/skills-vault/{skill-name}/SKILL.md` for vault-only skills.
  3. Follow the skill's instructions for the current task.
- For GitHub Actions, workflow runs/logs, PR state, issues, commits, branches, or release-download troubleshooting in
  **Copilot CLI**, load `github-troubleshooting` and prefer the built-in read-only `github-mcp-server` tools. The UI
  workspace MCP patch flow is for VS Code/workspace sessions, not a prerequisite for the CLI lane.
- If a skill is not found in either installed location, it is not installed — proceed with general knowledge.
- For spec-driven work, load `spec-dev` first to choose `spec-first`, `spec-anchored`, or `spec-as-source`.
- Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`; `spec-authoring` and `spec-review` are installed by default but should still be loaded only when the step needs spec guidance.
- See `docs/system/search-execute-workflow.md` for the canonical staged-routing model.
- Prefer canonical documentation in `docs/system/**`; use this file for routing/setup cues, not as a second copy of repo policy.
- Treat `.instructions/*` paths as legacy and use them only when a repository explicitly opts in.

## Implementation Friction Capture
- Constructive complaints about hard-to-work-with code are allowed when they help delivery.
- When recurring implementation friction is detected (shaky patterns, dead code, brittle design), load the `implementation-friction` skill.
- Capture issues quickly using the `~/.copilot/backlogs/{repo-name}/issues/implementation-friction-log.md` format, then continue implementation without deep side-tracking.

## Conflicts (repo-level + user-level)
- Assume repo-level instructions (e.g. `.github/copilot-instructions.md`) may add constraints.
- If instructions disagree:
  1) follow the **user’s explicit request** for the current task,
  2) then apply the **most specific** instructions for the file/area,
  3) and default to the **safer** option for anything involving security, data loss, or destructive actions.
- When in doubt, briefly call out the conflict and the resolution you chose, then proceed.

## Supporting context after canonical bootstrap
- For repo-rule or workflow decisions, start with `docs/system/index.md`, then the closest MOC, then the smallest relevant canonical node in `docs/system/**`.
- After that bootstrap, use the nearest applicable `guidelines.md`, then supporting repo docs such as `README.md`, `docs/`, or `documentation/`. Treat these as secondary context that can be stale and cannot outrank `docs/system/**`.

## Documentation Discovery Protocol
When task decisions depend on repository docs, follow this route first:
1. Open `docs/system/index.md`.
2. Choose the closest MOC in `docs/system/mocs/*.md`.
3. Follow that MOC to the minimal set of canonical nodes in `docs/system/**`.
4. Expand only when needed, and keep downstream briefs pointer-based instead of copying long policy blocks.

Use `guidelines.md` and `README.md` only as lighter local overlays after the canonical route is loaded.
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

