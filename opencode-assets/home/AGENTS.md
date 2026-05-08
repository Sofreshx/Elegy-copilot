# OpenCode Session Defaults

Instruction-engine shared baseline for OpenCode. Keep this file workflow-specific, not repo-specific.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. If the request mixes unrelated goals, split them into ordered work.
3. Use bounded read-heavy investigation before editing.
4. Implement in small, verifiable steps.
5. Run the narrowest relevant validation after changes (lint, typecheck, test, build).

## Clarification Standard

- Ask the user when a missing answer would change scope, architecture, data handling, destructive actions, or acceptance criteria.
- Do not ask about details that can be discovered from repo docs, code, tests, or current config.
- If only low-risk details are missing, state the assumption and proceed.
- When asking, keep questions few and concrete; prefer one blocking question over a questionnaire.

## Validation Standard

- Run the smallest relevant test, typecheck, lint, build, or runtime proof that covers the changed behavior.
- Escalate to broader tests only when repo policy, risk, cross-boundary coupling, or missing evidence requires them.
- Use repo-local or nested AGENTS.md for exact commands; do not invent global test commands.
- If validation is skipped or blocked, say why and identify the remaining risk.
- Treat passing tests as evidence, not proof; still inspect edge cases and diff scope.

## Delegation

OpenCode provides built-in agents and custom subagents from instruction-engine:

- **@code-explorer** — Fast read-only codebase search and analysis (light model)
- **@web-searcher** — Fast web research and documentation lookup (light model)

Use `@code-explorer` for codebase questions and `@web-searcher` for documentation lookups to keep main session context lean.

## Skills

Instruction-engine installs curated skills under OpenCode. Skills are loaded on-demand via the skill tool — they do not consume context until explicitly loaded.

Key skills available:
- `code-review` — High-precision code review with confidence scoring
- `security` — Security review and vulnerability detection
- `refactor` — Safe refactoring guidance and patterns
- `project-conventions-governance` — Repo conventions and governance
- `stack-detector` — Automatic tech stack detection

Use the skill tool to load relevant skills when domain guidance is needed.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local AGENTS.md only when a repo actually needs them.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.
