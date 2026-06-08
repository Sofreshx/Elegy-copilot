# Guidelines

Repo-specific rules for agents and humans working in Instruction Engine.

Start at `docs/system/index.md`. This file is the local overlay.

## Authority precedence

| Priority | Source | Override rule |
|---|---|---|
| 1 | Explicit user instruction | Always wins |
| 2 | `docs/system/**` canonical docs | Overrides all below |
| 3 | Nearest `guidelines.md` | Applies to files it covers |
| 4 | `README.md` + other maintained docs | Informational only |
| 5 | Repeated implementation patterns | Weakest, never overrides above |

## Core rules

| Rule | Detail |
|---|---|
| Validation | Run narrowest relevant check after every change (lint, typecheck, test). Use `commit-check-run` as pre-commit gate. |
| Asset changes | When changing shipped assets, update manifest + allowlist + validators together. |
| Lane agents | Use OpenCode lane agents (quick/standard/spec/project) as primary entry points. Subagents (impl, reviewer, explorer) handle bounded work. |
| Planning surface | Roadmap/backlog → `~/.copilot/backlogs/{repo-name}/`. Session state → `~/.copilot/session-state/<SESSION_ID>/`. |
| Baseline refresh | Use `scripts/` installers. Use `/init` only to create or refine repo-local guidance. |
| Conflict resolution | If `guidelines.md` conflicts with `docs/system/**`, follow `docs/system/**` and flag the conflict. |

## Doc sync rules

| When you change... | Update... |
|---|---|
| Sidebar, tabs, views, or routes | `docs/system/copilot-ui-guide.md` |
| Shipped asset count (agents, skills, prompts) | `README.md` asset inventory |
| New top-level directory | `README.md` repo layout |
| Agent behavior, skill contracts, workflow policy | Smallest relevant `docs/system/` node |
| Spec-driven work begins | `specs/<slug>/spec.md` + `specs/index.md` |
| CI, test matrix, or build scripts | `CONTRIBUTING.md` + `docs/system/ci-conventions.md` |

Doc updates must travel with code changes, not follow-ups.

## Key canonical nodes

- `docs/system/project-conventions-governance.md`
- `docs/system/documentation-structure-governance.md`
- `docs/system/self-documenting-code-and-rationale-placement.md`
- `docs/system/search-execute-workflow.md`
