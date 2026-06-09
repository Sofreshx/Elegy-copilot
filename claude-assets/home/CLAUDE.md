# Claude Code Session Defaults

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, Antigravity, and Claude Code agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime.

This is the shared Claude Code baseline installed to `~/.claude/CLAUDE.md`.
Keep this file workflow-specific; put target-repo commands, test details, and
local conventions in the target repo's own `CLAUDE.md` or canonical docs.
Follow `guidelines.md`: clarify ambiguity before implementation; write concise, precise, diagram-forward instructions; avoid vague or ceremonial prose.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. If the request mixes unrelated goals, split them into ordered work.
3. Use plan-first for non-trivial design before editing.
4. Investigate the codebase before deciding — read before writing.
5. Implement in small, verifiable steps.
6. Run the narrowest relevant validation after changes (lint, typecheck, test, build).
7. Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.

Keep instruction surfaces compact. Future specs and docs must be concise, map-like, and scoped to their stated purpose.

## Clarification Standard

- Ask the user when a missing answer would change scope, architecture, data handling, destructive actions, or acceptance criteria.
- Do not ask about details that can be discovered from repo docs, code, tests, or current config.
- If only low-risk details are missing, state the assumption and proceed.
- When asking, keep questions few and concrete; prefer one blocking question over a questionnaire.

## Validation Standard

- Run the smallest relevant test, typecheck, lint, build, or runtime proof that covers the changed behavior.
- Escalate to broader tests only when repo policy, risk, cross-boundary coupling, or missing evidence requires them.
- Use repo-local or nested `CLAUDE.md` for exact commands; do not invent global test commands.
- If validation is skipped or blocked, say why and identify the remaining risk.
- Treat passing tests as evidence, not proof; still inspect edge cases and diff scope.

## Skills

Instruction-engine installs curated skills under Claude Code. Skills are loaded on-demand
and should be used only when they materially improve the result.

Primary skills available:
- `skill-discovery` — Skill resolver for on-demand capability routing.
- `elegy-planning` — Durable planning authority via Elegy CLI. Use for goals, roadmaps,
  plans, todos, issues, review points, and validation backed by SQLite.
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work.
- `spec-dev` — Spec-driven router for spec-first and spec-anchored work.
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`.
- `spec-review` — Adversarial spec review before implementation planning.
- `stack-detector` — Automatic tech stack detection.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.

For the Instruction Engine repo itself, the current identity and delivery model are:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into the Copilot home install.
- `codex-assets/`, `opencode-assets/`, `antigravity-assets/`, and `claude-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.

For spec-driven work, use the current repo contract in `docs/system/spec-driven-development.md`:
durable specs live at `docs/specs/<spec-slug>/spec.md`, with optional `docs/specs/index.md`, and should be
validated with `node scripts/validate-specs.js <spec-root>` when the target repo has that validator.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `CLAUDE.md` only when a repo actually needs them.
- Prefer Claude Code-native behavior over recreating Copilot-specific workflows.
