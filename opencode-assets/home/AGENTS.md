# OpenCode Session Defaults

Instruction-engine shared baseline for OpenCode. Keep this file workflow-specific, not repo-specific.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. If the request mixes unrelated goals, split them into ordered work.
3. Use `Plan` for non-trivial design before editing.
4. Use `Explore` for read-only code discovery and `Scout` for external docs before creating more custom agent work.
5. Use `General` only when a bounded delegated child session will materially help.
6. Implement in small, verifiable steps in `Build`.
7. Run the narrowest relevant validation after changes (lint, typecheck, test, build).

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

## Native Agents

OpenCode's built-in agents stay primary:

- `Build` — main execution surface
- `Plan` — planning and critique without edits
- `Explore` — read-only codebase discovery
- `Scout` — external docs and dependency research
- `General` — bounded delegated multi-step work

The custom `@code-explorer` and `@web-searcher` subagents remain compatibility aliases during the transition, but they are not the primary recommended path.
Prefer the built-in `Explore` and `Scout` agents.

## Skills

Instruction-engine installs curated skills under OpenCode. Skills are loaded on-demand via the skill tool and should be loaded only when they materially improve the result.

Primary skills available:
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work
- `roadmap-planning` — Durable multi-session roadmap work under `docs/roadmaps/<roadmap-slug>.md`
- `implementation-handoff` — Executor-ready brief for another session or model
- `implementation-review` — Post-edit review before handoff
- `security` — Security review and vulnerability detection
- `project-conventions-governance` — Repo conventions and governance
- `stack-detector` — Automatic tech stack detection

Compatibility-only skills:
- `code-review`
- `refactor`

Use the skill tool when domain guidance changes the outcome, not just because a skill exists.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local AGENTS.md only when a repo actually needs them.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Do not recreate Copilot orchestration or session-state workflows in OpenCode.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.
