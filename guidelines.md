# Guidelines

This file is the lightweight human/agent entrypoint for repository-specific guidance. It does not
replace explicit user instructions or the canonical policy docs in `docs/system/**`.

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

## Current repo guidance

- Prefer the flagship orchestrators (`@orchestrator-gpt`, `@orchestrator-claude`, and CLI variants) as
  the main entry points.
- Keep the shipped subagent surface lean: planning through `@o-planner`, implementation through
  `@impl`, review through the single `@code-reviewer`, research through `@deep-researcher`, testing
  through `@test-runner`, and docs/persistence writing through `@doc-writer`.
- For planning surfaces, keep roadmap/backlog/issue artifacts under `~/.copilot/backlogs/{repo-name}/`
  and session execution artifacts under `~/.copilot/session-state/<SESSION_ID>/`.
- For agent or skill surface changes, update canonical docs, manifests, allowlists, validators, and
  tests together.
