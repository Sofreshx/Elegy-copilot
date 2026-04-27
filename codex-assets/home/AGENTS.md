# Codex Session Defaults

Use plan-first for non-trivial work. Stay in planning until the task is decision-complete and the constraints are clear enough to implement safely.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. Use the built-in `explorer` agent for bounded, read-heavy investigation and parallel fact-finding.
3. On complex tasks, ask the `reviewer` agent to critique the plan before editing files.
4. Implement in small, verifiable steps.
5. Run `/review` before handoff when code changed.

## Native Codex Tools

- To install or refresh the shared Codex agents and skills from this repo, run:
  - Windows: `pwsh -File scripts/codex-install.ps1 --force`
  - macOS/Linux: `bash scripts/codex-install.sh --force`
- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` only when a repository needs persistent repo-local Codex instructions or bootstrap files; do not use it for routine shared asset installation or refresh.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest
canonical node. Use `README.md` and `guidelines.md` as lighter local overlays after that route, not
as peer authority with `docs/system/**`.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
