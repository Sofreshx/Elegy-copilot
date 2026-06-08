# Codex Session Defaults

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime. Treat this
file as the global Codex baseline installed to `~/.codex/AGENTS.md`; keep
project-specific commands and conventions in the target repo's own `AGENTS.md`
or canonical docs.

Use plan-first for non-trivial work. Stay in planning until the task is decision-complete and the constraints are clear enough to implement safely.

Narrow candidate constraints to the minimum hard constraints needed for the active step. Keep shaping context and open questions separate.

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

## Skills

Instruction Engine installs curated skills under Codex. Skills are loaded on-demand
and should be used only when they materially improve the result.

Primary skills available:
- `elegy-planning` — Durable planning authority via Elegy CLI. Use for goals, roadmaps,
  plans, todos, issues, review points, and validation backed by SQLite. Prefer
  `elegy-planning` over `roadmap-planning` markdown roadmaps when the CLI is available.
- `roadmap-planning` — Durable multi-session roadmap work under
  `docs/roadmaps/<roadmap-slug>.md`. Fall back to this only when `elegy-planning`
  CLI is not available.
- `skill-discovery` — Skill resolver for on-demand capability routing.
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work.
- `implementation-review` — Post-edit review before handoff.
- `implementation-handoff` — Executor-ready brief for another session or model.
- `spec-dev` — Spec-driven router for spec-first and spec-anchored work.
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`.
- `spec-review` — Adversarial spec review before implementation planning.
- `stack-detector` — Automatic tech stack detection.
- `ui-system` — Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; treat Figma / Storybook MCP data as context, not authority.

### elegy-planning Availability

Before starting planning work, check whether `elegy-planning` is available on PATH.
If the binary is found, prefer it for durable planning state (goals, roadmaps, plans).
The shared planning database is located at the path in the
`INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH` environment variable (defaults to
`~/.copilot/elegy-planning.db`).

To initialize a Codex-side planning session:
```
elegy-planning session init
```

If `elegy-planning` is not available, fall back to `$roadmap-planning` for markdown
roadmap work.

## Native Codex Tools

- To install or refresh the shared Codex agents and skills from this repo, run:
  - Windows: `pwsh -File scripts/codex-install.ps1 --force`
  - macOS/Linux: `bash scripts/codex-install.sh --force`
- To refresh all supported Instruction Engine surfaces from this repo, run:
  - Windows: `pwsh -File scripts/install-all.ps1 --force`
  - macOS/Linux: `bash scripts/install-all.sh --force`
- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` only when a repository needs persistent repo-local Codex instructions or bootstrap files; do not use it for routine shared asset installation or refresh.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.
- Use `$elegy-planning` for persisted multi-session goals, roadmaps, and plans backed by SQLite; fall back to `$roadmap-planning` (markdown roadmaps under `docs/roadmaps/<roadmap-slug>.md`) only when the elegy-planning CLI is not available.
- Use `$spec-dev` when the task needs spec-first clarification, a durable repo spec under `docs/specs/<spec-slug>/spec.md`, or a narrow spec-as-source flow.
- Use `$spec-authoring` to create or refine durable specs under `docs/specs/`, then `$spec-review` before implementation planning when the spec will drive the work.
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.
- Use `$stack-detector` for explicit stack/target-context detection, and `$skill-discovery` when the right shared skill is still ambiguous after the first pass.
- Treat a Roadmap as durable multi-session planning above a session plan: it records goals, non-goals, targets, sequencing, progress, evidence, and reevaluation notes, while the current session implements one selected slice.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest
canonical node. Use `README.md` and `guidelines.md` as lighter local overlays after that route, not
as peer authority with `docs/system/**`.

For the Instruction Engine repo itself, the current identity and delivery model are:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into the Copilot home install.
- `codex-assets/`, `opencode-assets/`, and `antigravity-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.

For spec-driven work, use the current repo contract in `docs/system/spec-driven-development.md`:
durable specs live at `docs/specs/<spec-slug>/spec.md`, with optional `docs/specs/index.md`, and should be
validated with `node scripts/validate-specs.js <spec-root>` when the target repo has that validator.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Keep global Codex agents minimal. Prefer the built-in main agent plus a read-only reviewer; put domain behavior in repo-local `AGENTS.md` or repo-local skills.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
