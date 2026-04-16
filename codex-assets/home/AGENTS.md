# Codex Session Defaults

Use plan-first for non-trivial work. Stay in planning until the task is decision-complete and the constraints are clear enough to implement safely.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. Use the built-in `explorer` agent for bounded, read-heavy investigation and parallel fact-finding.
3. On complex tasks, ask the `reviewer` agent to critique the plan before editing files.
4. Implement in small, verifiable steps.
5. Run `/review` before handoff when code changed.

## Native Codex Tools

- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` when a repository needs persistent Codex instructions.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
