# OpenCode Session Defaults — Harness Appendix

Composed at install time with the shared baseline.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Native Agents

OpenCode's built-in agents stay primary for Tab-selection:

- `Build` — main execution surface
- `Plan` — planning and critique without edits
- `Explore` — read-only codebase discovery
- `Scout` — external docs and dependency research
- `General` — bounded delegated multi-step work

These are the OpenCode-native agents available at the TUI level. The `impl`, `explorer`,
`reviewer`, and `scout` subagents (described below) extend them for scoped implementation,
exploration, review, and research work.

## Skills

Elegy Copilot installs curated skills under OpenCode. Skills are loaded via the skill tool and should be loaded only when they materially improve the result.

Primary skills available:
- `skill-discovery` — Vault-first skill resolver for on-demand capability routing
- `elegy-planning` — Durable planning authority via Elegy CLI
- `elegy-skills-discovery` — CLI-based governed skill discovery via Elegy
- `rubberduck-plan-review` — Adversarial plan review before complex implementation work
- `implementation-handoff` — Executor-ready brief for another session or model
- `implementation-review` — Post-edit review before handoff
- `spec-dev` — Spec-driven router for spec-first, spec-anchored, and spec-as-source work
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`
- `spec-review` — Adversarial spec review before implementation planning
- `security` — Targeted security review for vulnerabilities LLMs commonly miss (secrets in git, auth bypass, dependency confusion, path traversal, cookie security, injection)
- `project-conventions-governance` — Repo conventions and governance
- `planning-tools` — OpenCode planning helpers backed by the planning plugin
- `project-workflow` — Project lane phase-by-phase execution guide (setup, plan, execute, complete)
- `worktree` — OpenCode worktree helper skill backed by the worktree plugin
- `commit-check-setup` — Bootstrap or update commit-check infrastructure in a repo. Copies scripts, generates `.copilot/commit-checks.json` config, runs smoke test. Use when setting up a repo for use with Elegy Copilot UI.
- `ui-system` — Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; treat Figma / Storybook MCP data as context, not authority.
- `ui-design-spec` — Convert design inputs (prompts, screenshots, Figma) into a structured repo-grounded UI specification. Use before building new surfaces or redesigns.
- `ui-visual-review` — Review rendered UI evidence against spec, repo conventions, and accessibility expectations without editing code. Use during review gates with visual evidence.
- `skill-authoring` — Create or refine portable Agent Skills (SKILL.md) that work across Codex, Claude Code, OpenCode, Cursor, and 30+ tools. Follows the [agentskills.io](https://agentskills.io/specification) open standard.
- `agents-md-authoring` — Create or refine per-harness instruction files (AGENTS.md, CLAUDE.md, GEMINI.md, copilot-instructions.md) that follow the open [AGENTS.md](https://agents.md) standard.

See the [Curated Subagents](#curated-subagents) section for built-in subagent descriptions and role routing.

Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.

Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`.
Follow `docs/system/spec-driven-development.md` in the Elegy Copilot repo when a target repo opts into spec-driven work. Specs are optional design artifacts; spec validation is not enforced as repo policy.
Specs describe intent (requirements). Docs describe state (how it works). ADRs record decisions (what was chosen).

## Elegy Copilot Repo Map

When the current workspace is Elegy Copilot / Elegy Copilot:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into `~/.elegy`.
- `catalog-assets/shared-skills/` ships cross-harness shared skills.
- `opencode-assets/`, `codex-assets/`, `antigravity-assets/`, `claude-assets/`, and `ghcp-assets/` ship thinner native home baselines for their harnesses.
- `copilot-ui/` is the local dashboard and catalog control plane; the packaged Windows desktop app is the normal end-user runtime.
- `contracts/`, `local-tracker/`, `scripts/`, and `docs/system/**` hold shared contracts, gateway/runtime support, installers/validators, and canonical policy.
- Start repo-rule work at `docs/system/index.md`, then the nearest MOC, then the smallest canonical node.

Compatibility-only skills:
- `code-review`

Use the skill tool when domain guidance changes the outcome, not just because a skill exists.

## Lane Agents

Elegy Copilot ships two primary lane agents for Tab-selection alongside OpenCode's built-in agents.
Lane agents enforce workflow phases and delegate to subagents for implementation and review.

### Primary Lane Agents

| Agent | Model | Description |
|---|---|---|
| `quick` | small (Flash) | Small UI tweaks and tiny bug fixes (<5 min, 1-2 files, no ambiguity) |
| `project` | big (Pro) | Multi-session roadmap work with elegy-planning, worktree isolation, evidence chains |

### Subagents (invoked by lane primaries)

| Agent | Model | Access | Description |
|---|---|---|---|
| `impl` | small (Flash) | Write-capable | Bounded implementation — file edits, commands, validation |
| `reviewer` | big (Pro) | Read-only | Review gate — code, spec, plan, and evidence review |
| `explorer` | small (Flash) | Read-only | Codebase discovery — patterns, traces, dependencies |
| `scout` | big (Pro) | Read-only (restricted bash) | External docs and dependency research |

Subagents are hidden from user autocomplete. Only lane primary agents invoke them via the Task tool.

### Provider Profiles

Profiles define model+provider routing across five task roles. Profiles are configured in `opencode-assets/profiles.json` and applied at install time or via the profile switch command.

| Role | Default (opencode-go-balanced) | Agents |
|---|---|---|
| `planning` | `opencode-go/deepseek-v4-pro` | `plan`, `project` |
| `implementation` | `opencode-go/deepseek-v4-flash` | `build`, `impl`, `quick` |
| `exploration` | `opencode-go/deepseek-v4-flash` | `explore`, `explorer` |
| `review` | `opencode-go/deepseek-v4-pro` | `reviewer` |
| `research` | `opencode-go/deepseek-v4-pro` | `scout` |

**Available profiles:**
- `opencode-go-balanced` — Go provider with DeepSeek defaults
- `opencode-go-fast` — Go provider with cheaper exploration models
- `opencode-zen-free` — Zen provider using free-tier models (best-effort, availability may change)
- `opencode-zen-mixed` — Zen free models for exploration/research, stronger models for planning/review
- `deepseek-direct` — DeepSeek models via direct API (fallback route)

Switch profiles:
```
node scripts/opencode-profile-switch.mjs <profile-id>
node scripts/opencode-profile-switch.mjs --list
node scripts/opencode-profile-switch.mjs --current
```

Profile definitions live in `opencode-assets/profiles.json`. The install script applies the active profile. Profile switching updates the model fields in all installed agent files under `~/.config/opencode/agents/` and writes both role-level `config.agentRoleModels.<role>.model` and legacy `config.agent.<name>.model` overrides to `opencode.jsonc`.

The legacy `small`/`big`/`review` profile fields remain supported for backward compatibility and normalize to role models at runtime.

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
commit or an immediately following commit. The reviewer subagent should flag stale or missing `updated`
dates as `rule_drift` when the code change touches the described surface.

See `docs/system/documentation-structure-governance.md` for the full Doc Freshness Sync Rule.

## Permission Pre-Allow

The following paths are pre-allowed for OpenCode operations on this machine.
Add these to your `opencode.jsonc` `allowedDirectories` or `permissions.allow`:

### OpenCode worktree roots
- `~/.local/share/opencode/worktree/` — Worktree isolation for project sessions
- `~/.local/share/opencode/worktree/.state/` — Plugin-local auxiliary state (not the durable authority)

### Shared worktree registry (Elegy Copilot authority)
- `~/.elegy/repo-state/` — Durable worktree records for dashboard, executor, and session coordination

### Elegy planning state
- `~/.elegy/planning.db` — Durable planning database for goals, roadmaps, plans, todos, issues, reviews, insights, and project-run evidence
- `~/.elegy/planning-session.json` — Active planning session sidecar
- `~/.elegy/managed-cli/planning/` — Managed elegy-planning CLI binary

Do not block directory access prompts for these paths during normal work.
