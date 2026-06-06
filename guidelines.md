# Guidelines

This file is the lightweight human/agent entrypoint for repository-specific guidance. It does not
replace explicit user instructions or the canonical policy docs in `docs/system/**`.

## Canonical breadcrumb

Start with `docs/system/index.md`, then the closest MOC, then the smallest canonical node for the
active task. Use this file only as the local overlay after that bootstrap.

## Authority

Use this precedence when work touches this repository:

1. explicit user instruction for the current task
2. canonical docs in `docs/system/**`
3. the nearest applicable `guidelines.md` for the repo or project being changed
4. other maintained docs such as `README.md`
5. repeated implementation patterns

## How to use this file

- Before write-capable work, load this file plus the smallest relevant canonical doc entrypoint.
- In this monorepo, project-level `guidelines.md` files may exist under top-level app/package roots;
  use the nearest one that covers the files you are changing.
- If guidance here conflicts with `docs/system/**`, follow `docs/system/**` and surface the conflict.
- For routing and governance questions, prefer canonical nodes such as
  `docs/system/project-conventions-governance.md`,
  `docs/system/self-documenting-code-and-rationale-placement.md`,
  `docs/system/documentation-structure-governance.md`, and
  `docs/system/search-execute-workflow.md`.

## Current repo guidance

- Use OpenCode lane agents (quick/standard/spec/project) as the main entry points for work in this
  repo. Subagents (impl, reviewer, explorer) handle bounded write, review, and discovery work.
- For planning surfaces, keep roadmap/backlog/issue artifacts under `~/.copilot/backlogs/{repo-name}/`
  and session execution artifacts under `~/.copilot/session-state/<SESSION_ID>/`.
- For agent or skill surface changes, update canonical docs, manifests, allowlists, validators, and
  tests together.
- For routine shared Copilot or Codex baseline refresh, use the install scripts in `scripts/`; use
  `/init` only when you need to create or refine repo-local guidance such as `guidelines.md` or
  `AGENTS.md`.
- Run the narrowest relevant validation after every change: lint, format, typecheck, and test. When
  applicable, use `commit-check-run` as the pre-commit umbrella gate.
