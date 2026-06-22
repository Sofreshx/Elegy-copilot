# Codex Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Concise Instruction Contract

Canonical authority: `docs/system/concise-instruction-governance.md` when the
target repo provides that node.

## Skills

Elegy Copilot installs curated skills under Codex. Skills are loaded on-demand
and should be used only when they materially improve the result.

Primary skills available:
- `elegy-planning` — Durable planning authority via Elegy CLI. Use for goals, roadmaps,
  plans, todos, issues, review points, and validation backed by SQLite.
- `skill-discovery` — Skill resolver for on-demand capability routing.
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work.
- `implementation-review` — Post-edit review before handoff.
- `implementation-handoff` — Deepens delegated plans into decision-complete briefs for another
  session, harness, or model; requires plan review for complex or incomplete source plans.
- `spec-dev` — Spec-driven router for spec-first and spec-anchored work.
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`.
- `spec-review` — Adversarial spec review before implementation planning.
- `commit-check-setup` — Bootstrap or update commit-check infrastructure in a repo. Copies scripts, generates `.copilot/commit-checks.json` config, runs smoke test.
- `ui-system` — Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; treat Figma / Storybook MCP data as context, not authority.
- `ui-design-spec` — Convert design inputs (prompts, screenshots, Figma) into a structured repo-grounded UI specification. Use before building new surfaces or redesigns.
- `ui-visual-review` — Review rendered UI evidence against spec, repo conventions, and accessibility expectations without editing code. Use during review gates with visual evidence.
- `skill-authoring` — Create or refine portable Agent Skills (SKILL.md) that work across Codex, Claude Code, OpenCode, Cursor, and 30+ tools. Follows the [agentskills.io](https://agentskills.io/specification) open standard.
- `agents-md-authoring` — Create or refine per-harness instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md) that follow the open [AGENTS.md](https://agents.md) standard.

### elegy-planning Availability

Before starting planning work, check whether `elegy-planning` is available on PATH.
If the binary is found, prefer it for durable planning state (goals, roadmaps, plans).
The shared planning database is located at the path in the
`INSTRUCTION_ENGINE_ELEGY_PLANNING_DB_PATH` environment variable (defaults to
`~/.elegy/planning.db`).

To initialize a Codex-side planning session:
```
elegy-planning session init
```

If `elegy-planning` is not available, fall back to markdown
roadmap work under `docs/roadmaps/<roadmap-slug>.md`.

## Native Codex Tools

- To install or refresh the shared Codex agents and skills from this repo, run:
  - Windows: `pwsh -File scripts/codex-install.ps1 --force`
  - macOS/Linux: `bash scripts/codex-install.sh --force`
- To refresh all supported Elegy Copilot surfaces from this repo, run:
  - Windows: `pwsh -File scripts/install-all.ps1 --force`
  - macOS/Linux: `bash scripts/install-all.sh --force`
- Prefer `/plan` for refactors, migrations, ambiguous features, and other multi-step work.
- Prefer `/init` only when a repository needs persistent repo-local Codex instructions or bootstrap files; do not use it for routine shared asset installation or refresh.
- Use `/fork` to branch a conversation without losing the original thread.
- Use `/resume` to continue prior work instead of rebuilding context from scratch.
- Use `PLANS.md` only for long-horizon work that must survive compaction or handoff. Do not create a file-backed plan by default.
- Use `$elegy-planning` for persisted multi-session goals, roadmaps, and plans backed by SQLite. Fall back to markdown roadmaps under `docs/roadmaps/<roadmap-slug>.md` only when the elegy-planning CLI is not available.
- Use `$spec-dev` when the task needs spec-first clarification, a durable repo spec under `docs/specs/<spec-slug>/spec.md`, or a narrow spec-as-source flow.
- Use `$spec-authoring` to create or refine durable specs under `docs/specs/`, then `$spec-review` before implementation planning when the spec will drive the work.
- Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.
- Use `$skill-discovery` when the right shared skill is still ambiguous.
- Treat a Roadmap as durable multi-session planning above a session plan: it records goals, non-goals, targets, sequencing, progress, evidence, and reevaluation notes, while the current session implements one selected slice.

## Repo docs breadcrumb

For repo-specific policy, start at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.

For the Elegy Copilot repo itself, the current identity and delivery model are:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into the Copilot home install.
- `catalog-assets/shared-skills/` ships cross-harness shared skills.
- `codex-assets/`, `opencode-assets/`, `antigravity-assets/`, and `claude-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.

For spec-driven work, use the current repo contract in `docs/system/spec-driven-development.md`:
durable specs live at `docs/specs/<spec-slug>/spec.md`, with optional `docs/specs/index.md`, and should be
treated as optional design artifacts. Spec validation is not enforced as repo policy.
Specs describe intent (requirements). Docs describe state (how it works). ADRs record decisions (what was chosen). See `docs-practice` skill for structure guidance.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local `AGENTS.md` only when a repo actually needs them.
- Keep global Codex agents minimal. Prefer the built-in main agent plus a read-only reviewer; put domain behavior in repo-local `AGENTS.md` or repo-local skills.
- Prefer Codex-native behavior over recreating Copilot-specific workflows.
