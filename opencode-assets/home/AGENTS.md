# OpenCode Session Defaults

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime.

This is the shared OpenCode baseline installed to the user's OpenCode home.
Keep this file workflow-specific; put target-repo commands, test details, and
local conventions in the target repo's own `AGENTS.md`, `guidelines.md`, or
canonical docs.

## Workflow

1. Ask clarifying questions when missing details would change the implementation.
2. If the request mixes unrelated goals, split them into ordered work.
3. Use `Plan` for non-trivial design before editing.
4. Use `Explore` for read-only code discovery and `Scout` for external docs before creating more custom agent work.
5. Use `General` only when a bounded delegated child session will materially help.
6. Implement in small, verifiable steps in `Build`.
7. Run the narrowest relevant validation after changes (lint, typecheck, test, build).
8. Narrow candidate constraints to the minimum hard constraints needed for the active step; keep shaping context and open questions separate.

## Clarification Standard

- Ask the user when a missing answer would change scope, architecture, data handling, destructive actions, or acceptance criteria.
- Do not ask about details that can be discovered from repo docs, code, tests, or current config.
- If only low-risk details are missing, state the assumption and proceed.
- When asking, keep questions few and concrete; prefer one blocking question over a questionnaire.

## Validation Standard

- Run the smallest relevant test, typecheck, lint, build, or runtime proof that covers the changed behavior.
- Escalate to broader tests only when repo policy, risk, cross-boundary coupling, or missing evidence requires them.
- Use repo-local or nested AGENTS.md for exact commands; do not invent global test commands.
- If validation is skipped or blocked, say why and identify the remaining risk.
- Treat passing tests as evidence, not proof; still inspect edge cases and diff scope.

## Native Agents

OpenCode's built-in agents stay primary for Tab-selection:

- `Build` — main execution surface
- `Plan` — planning and critique without edits
- `Explore` — read-only codebase discovery
- `Scout` — external docs and dependency research
- `General` — bounded delegated multi-step work

These are the OpenCode-native agents available at the TUI level, distinct from the
same-named subagents in the lane system below. Prefer the built-in `Explore` and `Scout`
for standalone discovery; use the `explorer` subagent only inside a lane workflow.

## Skills

Instruction-engine installs curated skills under OpenCode. Skills are loaded on-demand via the skill tool and should be loaded only when they materially improve the result.

Primary skills available:
- `skill-discovery` — Vault-first skill resolver for on-demand capability routing
- `elegy-planning` — Durable planning authority via Elegy CLI
- `elegy-skills-discovery` — CLI-based governed skill discovery via Elegy
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work
- `roadmap-planning` — Durable multi-session roadmap work under `docs/roadmaps/<roadmap-slug>.md`
- `implementation-handoff` — Executor-ready brief for another session or model
- `implementation-review` — Post-edit review before handoff
- `spec-dev` — Spec-driven router for spec-first, spec-anchored, and spec-as-source work
- `spec-authoring` — Durable spec authoring under `specs/<spec-slug>/spec.md`
- `spec-review` — Adversarial spec review before implementation planning
- `security` — Security review and vulnerability detection
- `project-conventions-governance` — Repo conventions and governance
- `stack-detector` — Automatic tech stack detection
- `elegy-obsidian` — Foundation skill for read/write/search operations against a local Obsidian vault via the official Obsidian Desktop CLI (v1.12+). Non-authoritative mirror; durable planning state stays in `elegy-planning`.

See the [Lane Agents](#lane-agents) section for lane selection, agent profiles, and escalation rules.

Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.

Durable repo specs default to `specs/<spec-slug>/spec.md` with optional `specs/index.md`.
Follow `docs/system/spec-driven-development.md` in the Instruction Engine repo when a target repo opts into spec-driven work, and run the target repo's `node scripts/validate-specs.js <spec-root>` validator when present.

## Instruction Engine Repo Map

When the current workspace is Instruction Engine / Elegy Copilot:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into `~/.copilot`.
- `opencode-assets/`, `codex-assets/`, and `antigravity-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.
- Start repo-rule work at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.

Compatibility-only skills:
- `code-review`

Use the skill tool when domain guidance changes the outcome, not just because a skill exists.

## Lane Agents

Instruction Engine ships four primary lane agents and three supporting subagents. Lane agents are selected via **Tab cycling** in OpenCode, just like the built-in Build and Plan agents. They enforce workflow phases and delegate to subagents for implementation, review, and exploration.

### Primary Lane Agents

| Agent | Model | Spec | elegy-planning | Description |
|-------|-------|------|----------------|-------------|
| `quick` | small (Flash) | No | No | <5 min, 1-2 files, no ambiguity |
| `standard` | big (Pro) | No | No | Scoped features, normal bug fixes |
| `spec` | big (Pro) | Yes | Yes | Contract/API/user-facing, spec-first |
| `project` | big (Pro) | Yes (per WP) | Yes | Multi-session roadmap work, orchestrator |

### Subagents (invoked by lane primaries)

| Agent | Model | Access | Description |
|-------|-------|--------|-------------|
| `impl` | small (Flash) | Write-capable | Build replacement — file edits, commands, validation |
| `reviewer` | big (Pro) | Read-only | Review gate — code, spec, plan, and evidence review |
| `explorer` | small (Flash) | Read-only | Codebase discovery — patterns, traces, dependencies |

Subagents are hidden from user autocomplete. Only lane primary agents invoke them via the Task tool.

### Lane Quick
Small UI tweaks and tiny bug fixes. Flash only; no spec or roadmap required.

- **Model:** `small` (DeepSeek V4 Flash)
- **Escalation:** Not needed; if scope exceeds lane bounds, tell user to switch to `standard`
- **Spec required:** No
- **Worktree required:** No
- **Validation:** Narrowest relevant lint/test

### Lane Standard
Scoped feature or normal bug fix. Pro for implementation; reviewer subagent for gates.

- **Model:** `big` (DeepSeek V4 Pro)
- **Escalation:** Delegate to `reviewer` subagent for design ambiguity, architecture decisions, and final review
- **Spec required:** No (but recommended for anything that touches user-facing behavior)
- **Worktree required:** No
- **Validation:** Focused tests, lint, typecheck

### Lane Spec
Contract, workflow, API, or user-facing behavior changes. Spec-first workflow with mandatory review gates. Uses elegy-planning for state tracking.

- **Model:** `big` (DeepSeek V4 Pro)
- **Gates:** `reviewer` subagent for spec review (before implementation) and plan review
- **Spec required:** Yes — durable spec under `specs/<slug>/spec.md`
- **Worktree required:** No
- **Validation:** Spec validation + focused tests
- **Skills:** Load `spec-dev`, `spec-authoring`, `spec-review`, `elegy-planning`

### Lane Project
Multi-session roadmap work. Orchestrator that coordinates elegy-planning goal/roadmap/plan, worktrees, evidence chains, and review gates.

- **Model:** `big` (DeepSeek V4 Pro)
- **Gates:** `reviewer` subagent at each plan: plan review, implementation review, evidence review
- **Spec required:** Yes (per plan)
- **Worktree required:** Yes — use `worktree_create`, manual commit, `worktree_delete`
- **Validation:** Full evidence chain: expectations → results → review
- **Skills:** Load `elegy-planning`, `roadmap-planning`, `worktree`, `implementation-review`, `rubberduck-plan-review`

### Provider Profiles

Profiles define model+provider routing for all lane agents and subagents. Profiles are configured in `opencode-assets/profiles.json` and applied at install time or via the profile switch command.

| Profile field | Default | Description |
|---|---|---|
| `small` | `deepseek/deepseek-v4-flash` | Cheap model for exploration and implementation (quick, impl, explorer) |
| `big` | `deepseek/deepseek-v4-pro` | Capable model for primary lanes (standard, spec, project) |
| `review` | `deepseek/deepseek-v4-pro` | Model for review gates (reviewer subagent) |
| `reasoningEffort` | `high` | Max reasoning effort on all DeepSeek models |

**Available profiles:**
- `opencode-go` — DeepSeek models via OpenCode Go (native provider)
- `deepseek-direct` — DeepSeek models via direct API (fallback route)

Switch profiles:
```
node scripts/opencode-profile-switch.mjs deepseek-direct
```

Profile definitions live in `opencode-assets/profiles.json`. The install script applies the active profile. Profile switching updates the model fields in all installed agent files under `~/.config/opencode/agents/`.

### Lane Agent Selection
Switch between lane agents using **Tab** in the OpenCode TUI:
- `quick` — Quick fixes and small UI tweaks
- `standard` — Scoped features and normal bug fixes
- `spec` — Spec-driven contract/API work
- `project` — Multi-session roadmap work with Elegy Planning

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local AGENTS.md only when a repo actually needs them.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Do not recreate Copilot orchestration or session-state workflows in OpenCode.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.

## Doc Sync Discipline

Canonical docs and code are a shared surface. When code changes a public contract, workflow policy,
or command path, the owning canonical doc's frontmatter `updated` field MUST be bumped in the same
commit or an immediately following commit. Reviewer lanes should flag stale or missing `updated`
dates as `rule_drift` when the code change touches the described surface.

See `docs/system/documentation-structure-governance.md` for the full Doc Freshness Sync Rule.

## Permission Pre-Allow

The following paths are pre-allowed for OpenCode operations on this machine.
Add these to your `opencode.jsonc` `allowedDirectories` or `permissions.allow`:

### OpenCode worktree roots
- `~/.local/share/opencode/worktree/` — Worktree isolation for project-lane sessions
- `~/.local/share/opencode/worktree/.state/` — Plugin-local auxiliary state (not the durable authority)

### Shared worktree registry (Elegy Copilot authority)
- `~/.copilot/repo-state/` — Durable worktree records for dashboard, executor, and session coordination

### Elegy planning state
- `~/.elegy/` — Elegy planning database and configuration
- `~/.copilot/managed-cli/planning/` — Managed elegy-planning CLI binary

Do not block directory access prompts for these paths during normal project-lane work.
