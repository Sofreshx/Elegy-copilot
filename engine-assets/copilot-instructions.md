# Copilot Instructions (CLI-first, VS Code compatible)

This file is intended to be installed to:
`~/.copilot/copilot-instructions.md`

These instructions are optimized for **Copilot CLI** stock modes (**/plan** and **/fleet**) while remaining compatible with VS Code Copilot Chat.
Assume **both** user-level and repo-level instructions apply; conflicts can be non-deterministic, so explicitly reconcile them (see “Conflicts” below).

## CRITICAL: run_in_terminal MUST NEVER USE isBackground=true

** NEVER DO THIS:**
```
run_in_terminal(command: "make build", isBackground: true)  # WRONG! Causes silent failures
run_in_terminal(command: "git commit", isBackground: true)   # WRONG! Command gets cancelled
```
## ALWAYS USE vscode/askQuestion
When you need clarification from the user, use `vscode/askQuestion` to ask a single, targeted question. This keeps the interaction focused and allows you to continue working on non-blocked tasks in parallel, so you don't have to stop execution for potentially trivial issues.

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

## Operating rules (global)
- Prefer small, verifiable changes.
- Do **not** change git branches unless explicitly asked.
- Do **not** run terminal commands in background/detached modes for builds/tests/commits.
- If instructions conflict, choose the **safer** interpretation and state what you’re doing.

## /plan (required workflow)
When I use **/plan** OR custom plan agent, you MUST:
1. Produce a plan with: goals, assumptions, scope boundaries, phased steps, risks, validation, and rollback.
2. Submit the plan for cross-model review by **BOTH** reviewers:
   - `@reviewer-opus-4-6`
   - `@reviewer-gpt-5-3-codex`
3. Revise the plan and re-review **until BOTH reviewers explicitly respond “APPROVED”**.
4. Only after both approvals: summarize the approved plan and proceed to execution (unless I asked for plan-only).

If a reviewer cannot approve due to missing info, propose the smallest set of clarifying questions, but keep refining everything else first.

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
- Maintain a short “integration step” at the end of each chunk: build/test the narrowest relevant checks.

## Subagents (speed + context)
- Delegate aggressively for speed:
  - exploration/synthesis → `@code-explorer` (or `explore` agent)
  - running builds/tests → `@unit-test-runner` / `@integration-test-runner` (or `task` agent)
  - high-signal review → `@code-reviewer`
  - request briefing + /fleet workstream split → `@brief` when the work is non-trivial
- Keep context lean:
  - quote only the minimum necessary code, paths, and logs,
  - prefer file paths + line ranges over large pastes,
  - keep summaries under ~300 words per workstream unless I ask for depth.

## Using Instruction Engine assets
- When domain-specific behavior matters, load the relevant skill (`SKILL.md`) before implementing changes.
- Keep repo-local memory and tasks under `.instructions/` (not inside this distribution).

## Conflicts (repo-level + user-level)
- Assume repo-level instructions (e.g. `.github/copilot-instructions.md`) may add constraints.
- If instructions disagree:
  1) follow the **user’s explicit request** for the current task,
  2) then apply the **most specific** instructions for the file/area,
  3) and default to the **safer** option for anything involving security, data loss, or destructive actions.
- When in doubt, briefly call out the conflict and the resolution you chose, then proceed.

## Main context sources
- **Repo docs**: `README.md`, `docs/`, `documentation/`,
assume those might be outdated sometimes, still do check them for high level guidance and constraints.

