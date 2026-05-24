# Codex Session Defaults

Use plan-first for non-trivial work. Stay in planning until the task is decision-complete and the constraints are clear enough to implement safely.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. If the request mixes unrelated goals, split them into ordered work or use `$roadmap-planning`.
3. Use bounded read-heavy investigation before editing; delegate only when the user explicitly asks for subagents or the current Codex runtime exposes a clear built-in lane for that work.
4. On complex tasks, ask the read-only `reviewer` agent to critique the plan before editing files when delegation is available.
5. Implement in small, verifiable steps.
6. Run `/review` before handoff when code changed.

## Clarification Standard

- Ask the user when a missing answer would change scope, architecture, data handling, destructive actions, external costs, or acceptance criteria.
- Do not ask about details that can be discovered from repo docs, code, tests, or current config.
- If only low-risk details are missing, state the assumption and proceed.
- When asking, keep questions few and concrete; prefer one blocking question over a questionnaire.

## Review Discipline

- For non-trivial work, write the smallest safe plan before editing.
- Use `$rubberduck-plan-review` before implementing complex plans, migrations, refactors, or repo setup changes.
- Before claiming success, try to falsify the result: inspect the diff, check edge cases, and verify behavior.
- Use `$implementation-review` after substantial edits or when checking whether implementation matches the plan.
- Treat review as adversarial analysis of correctness, scope, safety, and missing validation.
- Report validation evidence and gaps explicitly.

## Validation Standard

- Run the smallest relevant test, typecheck, lint, build, or runtime proof that covers the changed behavior; do not stack broad validation layers by default.
- Escalate to broader tests only when repo policy, risk, cross-boundary coupling, or missing evidence requires them.
- Use repo-local or nested `AGENTS.md` for exact commands; do not invent global test commands.
- If validation is skipped or blocked, say why and identify the remaining risk.
- Treat passing tests as evidence, not proof; still inspect edge cases and diff scope.

## Native Codex Tools

- To install or refresh the shared Codex agents and skills from this repo, run:
  - Windows: `pwsh -File scripts/codex-install.ps1 --force`
  - macOS/Linux: `bash scripts/codex-install.sh --force`
- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` only when a repository needs persistent repo-local Codex instructions or bootstrap files; do not use it for routine shared asset installation or refresh.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.
- Use `$roadmap-planning` for persisted multi-session goals under `docs/roadmaps/<roadmap-slug>.md`; update the roadmap lightly after completing a slice.
- Use `$spec-dev` when the task needs spec-first clarification, a durable repo spec under `specs/<spec-slug>/spec.md`, or a narrow spec-as-source flow.
- Use `$spec-authoring` to create or refine durable specs under `specs/`, then `$spec-review` before implementation planning when the spec will drive the work.
- Use `$stack-detector` for explicit stack/target-context detection, and `$skill-discovery` when the right shared skill is still ambiguous after the first pass.
- Treat a Roadmap as durable multi-session planning above a session plan: it records goals, non-goals, targets, sequencing, progress, evidence, and reevaluation notes, while the current session implements one selected slice.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest
canonical node. Use `README.md` and `guidelines.md` as lighter local overlays after that route, not
as peer authority with `docs/system/**`.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Keep global Codex agents minimal. Prefer the built-in main agent plus a read-only reviewer; put domain behavior in repo-local `AGENTS.md` or repo-local skills.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
