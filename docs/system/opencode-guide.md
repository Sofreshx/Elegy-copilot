---
created: 2026-05-11
updated: 2026-05-29
category: system
status: current
doc_kind: node
id: opencode-guide
summary: Current native-first operating model for OpenCode.
tags: [opencode, agents, skills, worktree]
related: [catalog-control-plane, skills-governance, search-execute-workflow]
---

# OpenCode Guide

## Purpose

Instruction Engine keeps OpenCode native-first and skill-heavy. Use OpenCode's built-in agents first and add only a small shared global layer.

## Install Or Refresh

```powershell
pwsh -File scripts/opencode-install.ps1
bash scripts/opencode-install.sh
```

- Add `--force` to overwrite managed files.
- Add `--dry-run` to preview writes.
- The installer writes `~/.config/opencode/AGENTS.md`, curated skills under `~/.config/opencode/skills/`, and the worktree plugin under `~/.config/opencode/plugins/`.
- The installer does not edit `opencode.json`.
- The installer can also bootstrap a selected repo for opt-in spec-driven setup with `--repo-root <path> --setup-profile spec-driven --elegy-cli <path>`.
- `INSTRUCTION_ENGINE_ELEGY_CLI_PATH` is still accepted as a fallback when rerunning the same local setup.

## Operating Model

- Built-in agents stay primary: `Build`, `Plan`, `Explore`, `Scout`, `General`.
- Primary skills: `skill-discovery`, `rubberduck-plan-review`, `roadmap-planning`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, `stack-detector`, `worktree`, `elegy-obsidian`.
- Planning, review, and spec skills are installed by default under `~/.config/opencode/skills/`; load them with the skill tool only when they materially improve the current step.
- Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.
- Shared installed planning and review behavior now narrows constraints to the minimum active set and treats ADRs as key-decision records rather than default documentation for every non-trivial change.
- Compatibility-only surfaces: `code-review`, `refactor`.
- Prefer model overrides in `opencode.json` over adding more custom agents.
- Keep repo-specific guidance in repo `AGENTS.md`.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Prefer the installer-based `spec-driven` profile for repeatable repo-local spec scaffolding instead of inventing a separate OpenCode-specific bootstrap path.

## Agentic Lanes

OpenCode provides four public lane agents for matching effort to task scope. Select the agent via Tab cycling in OpenCode:

- **quick**: Small UI tweaks and tiny bug fixes; Flash only; no spec or roadmap
- **standard**: Scoped features and normal bug fixes; Flash for execution, Pro at gates
- **spec**: Contract/API/user-facing behavior; spec-first workflow; Pro for spec review
- **project**: Multi-session roadmap work; Elegy Planning, worktree, evidence, review

See `opencode-assets/home/AGENTS.md` (installed to `~/.config/opencode/AGENTS.md`) for the full OpenCode Method specification.

### Provider Profiles

Profiles configure model routing across lanes. Both DeepSeek V4 Pro Max and V4 Flash Max use max reasoning effort at all times.

| Field | Default | Description |
|---|---|---|
| `small` | DeepSeek V4 Flash Max | Cheap model for exploration/implementation |
| `big` | DeepSeek V4 Pro Max | Capable model for gates and review |
| `review` | DeepSeek V4 Pro High | Model for spec/plan/review gates |
| `route` | `opencode-go` | Provider route (opencode-go or deepseek-direct) |

Default route is OpenCode Go; direct DeepSeek is a configurable fallback. Use `/connect` in OpenCode TUI to set provider credentials.

Max reasoning is set in `opencode.jsonc` with `reasoningEffort: "high"` on all agent configs that use DeepSeek models (build, plan, explore, scout). This pass-through option maps to the DeepSeek API `reasoning_effort` parameter.

## Worktree Plugin

The worktree plugin provides isolated git workspaces for feature work. It registers three tools:

- `worktree_create(branch, baseBranch?)` — Creates a git worktree with automatic project setup
- `worktree_list()` — Lists all worktrees for the current project
- `worktree_delete(branch, force?, commitBeforeDelete?)` — Removes a worktree (does NOT auto-commit by default; use `commitBeforeDelete: true` to commit before removal)

Worktrees are created under `~/.local/share/opencode/worktree/<project>/<branch>`.

To customize file sync between worktrees, create `.opencode/worktree.json` in your project root:
```json
{ "syncFiles": [".env", ".env.local", "config/local.json"] }
```

The plugin also injects `OPENCODE_WORKTREE_PATH`, `OPENCODE_WORKTREE_ROOT`, and `OPENCODE_PROJECT_ID` env vars into all shell commands.

## Catalog And External Sources

- `Catalog > Status` can activate external-source skills for OpenCode under `~/.config/opencode/skills/`.
- External-source MCP servers for OpenCode are materialized through `~/.config/opencode/opencode.json`.
- Source activation is global, not repo-scoped.

## Quick Checks

- Re-run `scripts/opencode-install.* --force` if shared skills are missing.
- Check `opencode.json` if built-in model overrides are not applying.
- Restart OpenCode after changing `opencode.json`.
- Worktree plugin loads automatically via `opencode.json` plugin config.
