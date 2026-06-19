---
created: 2026-05-11
updated: 2026-06-16
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
- The installer writes agent model overrides into `opencode.jsonc` under `agent.<name>.model` and `agentRoleModels.<role>.model`.
- The installer can also bootstrap a selected repo for opt-in spec-driven setup with `--repo-root <path> --setup-profile spec-driven --elegy-cli <path>`.
- `INSTRUCTION_ENGINE_ELEGY_CLI_PATH` is still accepted as a fallback when rerunning the same local setup.

## Operating Model

- Built-in agents stay primary: `Build`, `Plan`, `Explore`, `Scout`, `General`.
- Primary skills: `skill-discovery`, `rubberduck-plan-review`, `planning-tools`, `project-workflow`, `implementation-review`, `implementation-handoff`, `spec-dev`, `spec-authoring`, `spec-review`, `security`, `project-conventions-governance`, `stack-detector`, `worktree`, `elegy-obsidian`.
- Planning, review, and spec skills are installed by default under `~/.config/opencode/skills/`; load them with the skill tool only when they materially improve the current step.
- Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`.
- Shared installed planning and review behavior now narrows constraints to the minimum active set and treats ADRs as key-decision records rather than default documentation for every non-trivial change.
- Compatibility-only surfaces: `code-review`, `refactor`.
- Prefer role-level model overrides in `opencode.jsonc` (`agentRoleModels.<role>.model`) over adding more custom agents. Legacy `agent.<name>.model` overrides remain supported.
- Keep repo-specific guidance in repo `AGENTS.md`.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Prefer the installer-based `spec-driven` profile for repeatable repo-local spec scaffolding instead of inventing a separate OpenCode-specific bootstrap path.

## Agentic Lanes

Instruction Engine ships two primary lane agents for matching effort to task scope. Select the agent
via Tab cycling in OpenCode alongside the built-in Build and Plan agents.

- **quick**: Small UI tweaks and tiny bug fixes; Flash only; no spec or roadmap
- **project**: Multi-session roadmap work; Elegy Planning, worktree, evidence, review

### Curated Subagents

The following subagents extend OpenCode's built-in agents for scoped implementation, exploration,
review, and research. Invoke via the Task tool or `@mention` from any primary agent.

| Agent | Access | Description |
|---|---|---|
| `impl` | Write-capable | Bounded implementation — file edits, commands, validation |
| `reviewer` | Read-only | Review gate — code, spec, plan, and evidence review |
| `explorer` | Read-only | Codebase discovery — patterns, traces, dependencies |
| `scout` | Read-only (restricted bash) | External docs and dependency research |

Support subagents are leaf-only. `impl`, `explorer`, `reviewer`, `scout`, and managed note subagents
must deny Task delegation. Validate with `node scripts/validate-opencode-agent-topology.js`.

### Provider Profiles

Profiles configure model routing across five task roles. Each profile maps models to roles using OpenCode Go (`opencode-go/<model-id>`) or OpenCode Zen (`opencode/<model-id>`) provider prefixes. DeepSeek models use their built-in default reasoning effort (e.g., `deepseek-v4-pro` defaults to `high`, `deepseek-v4-flash` defaults to `medium`).

| Role | Description | Agents |
|---|---|---|
| `planning` | Planning, spec authoring, roadmap work | `plan`, `project` |
| `implementation` | Code edits, file writes, commands | `build`, `impl`, `quick` |
| `exploration` | Read-only code discovery | `explore`, `explorer` |
| `review` | Review gates (spec, plan, code) | `reviewer` |
| `research` | External docs and dependencies | `scout` |

#### Curated Profiles

| Profile | Description |
|---|---|
| `opencode-go-balanced` | Go provider with DeepSeek defaults — Pro for planning/review/research, Flash for implementation/exploration |
| `opencode-go-fast` | Go provider with cheaper models — Pro for planning/review, Flash for all others |
| `opencode-zen-free` | Zen provider using free-tier models — best-effort curated IDs |
| `opencode-zen-mixed` | Zen free models for exploration/research, stronger models for planning/review |
| `deepseek-direct` | Direct DeepSeek API fallback route |

Profiles are defined in `opencode-assets/profiles.json` and applied at install time or via the profile switch command:

```
node scripts/opencode-profile-switch.mjs <profile-id>
node scripts/opencode-profile-switch.mjs --list
node scripts/opencode-profile-switch.mjs --current
```

The installer writes both role-level (`config.agentRoleModels.<role>.model`) and legacy agent-level (`config.agent.<name>.model`) overrides to `opencode.jsonc`. The dashboard Profiles tab shows all available profiles with their role model assignments.

The legacy `small`/`big`/`review` profile fields remain supported for backward compatibility and normalize to `roleModels` at runtime.

## Worktree Plugin

The worktree plugin provides isolated git workspaces for feature work. It registers three tools:

- `worktree_create(branch, baseBranch?)` — Creates a git worktree with automatic project setup
- `worktree_list()` — Lists all worktrees for the current project
- `worktree_delete(branch, force?)` — Removes a worktree. Dirty worktrees require `force: true` (discards changes). Does NOT auto-commit.

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
- Check `opencode.jsonc` if built-in model overrides are not applying.
- Restart OpenCode after changing `opencode.json`.
- Worktree plugin loads automatically via `opencode.json` plugin config.
