# Antigravity Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Skills and routing

Shared routing skills include `skill-discovery`.

Planning, review, and spec skills are installed by default: `elegy-planning`, `rubberduck-plan-review`, `implementation-handoff`, `implementation-review`, `spec-dev`, `spec-authoring`, and `spec-review`.
Authoring skills for skills and per-harness instruction files: `skill-authoring` and `agents-md-authoring`.
Load them only when the current step needs that guidance.
Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`; follow the current contract in `docs/system/spec-driven-development.md` when the target repo opts into spec-driven work.
Specs describe intent (requirements). Docs describe state (how it works). ADRs record decisions (what was chosen). See `docs-practice` skill for structure guidance.

When a task clearly maps to an installed skill, load and follow that skill before proceeding.

## Repo map

When the current workspace is Elegy Copilot / Elegy Copilot, start repo-rule work at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node. The key repo centers are `engine-assets/` for Copilot assets, `antigravity-assets/` for this installed home baseline, `copilot-ui/` for the local dashboard/catalog control plane, and `scripts/` for installers and validators.
