# Claude Code Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

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
- `commit-check-setup` — Bootstrap or update commit-check infrastructure in a repo. Copies scripts, generates `.copilot/commit-checks.json` config, runs smoke test.

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
