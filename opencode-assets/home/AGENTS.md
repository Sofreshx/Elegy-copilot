# OpenCode Session Defaults

Instruction Engine, also published as Elegy Copilot, is the shared asset and
control-plane workspace for Copilot, Codex, OpenCode, and Antigravity agents,
skills, prompts, repo setup overlays, and the local dashboard/runtime.

This is the shared OpenCode baseline installed to the user's OpenCode home.
Keep this file workflow-specific; put target-repo commands, test details, and local conventions in the target repo's own `AGENTS.md` or canonical docs.

## Authority

| Priority | Source |
|---|---|
| 1 | Explicit user instruction |
| 2 | Repo-local canonical docs |
| 3 | `README.md` and maintained docs |
| 4 | Repeated implementation patterns |

If sources conflict, follow the highest authority and report the conflict.

## Concise Instruction Contract

Concise, precise instruction is required.

Write to transfer decisions, not to sound complete. Prefer exact terms, diagrams, tables, checklists, contracts, and examples over prose.

| Use | Avoid |
|---|---|
| Named term | Repeating the same idea in new words |
| Diagram | Long system description |
| Table | Paragraph comparing options |
| Checklist | Requirement paragraph |
| Contract | Vague guidance |
| Example | Abstract explanation |
| Link | Copied policy text |

Rules:

- Start with the point.
- Use active voice.
- Use short sentences by default.
- Use exact vocabulary.
- Define key terms once.
- Reuse defined terms consistently.
- Replace vague nouns with named concepts.
- Replace long explanation with a diagram, table, checklist, or example.
- Delete ceremonial openings and closings.
- Delete restatement.
- Delete throat-clearing.
- Delete empty emphasis.

Bad:

```text
This system provides a robust and flexible way to manage documentation across multiple workflows.
```

Good:

```text
Documentation authority:
README -> canonical entrypoint -> canonical node
```

A section must answer at least one question:

- What is the purpose?
- What is the contract?
- Who owns it?
- When is it used?
- What can fail?
- How is it verified?
- What is the next link?

If it answers none, remove it.

## Clarification Contract

Never implement through ambiguity.

If user intent is unclear, clarify before planning or implementation. Use available question tools when the environment provides them. Ask few questions, but make them decision-changing.

Clarify when uncertainty affects:

- scope
- architecture
- data handling
- destructive action
- external cost
- user-visible behavior
- acceptance criteria
- validation
- ownership
- security or privacy

Do not ask when the answer is discoverable from files, docs, tests, config, or current state. Investigate first.

Good clarification:

```text
Which source should be authoritative for this change?
- Repo-local canonical docs: durable repo policy
- Harness instructions only: local entrypoint
```

Bad clarification:

```text
Can you clarify what you want?
```

If two steps depend on an unstated assumption, stop and clarify before crossing that boundary.

## Planning Contract

Do not jump from intent to edits.

Before implementation:

1. Read the relevant local sources.
2. Identify the authority path.
3. State the goal and success criteria.
4. Separate facts from assumptions.
5. Resolve blocking ambiguity.
6. Choose the smallest implementation path.
7. Define validation.

Do not assume unclear parts will work out during implementation.

Use plan-first for non-trivial work. A plan is ready only when another implementer can execute it without making product or architecture decisions.

## Documentation Shape

Default shape:

```text
Point
Contract, diagram, or table
Operational details
Validation or next link
```

Documentation should route downward:

```text
README / harness instructions
  -> repo-local canonical entrypoint
    -> relevant topic
      -> smallest canonical node
```

Keep secondary surfaces thin. Do not duplicate canonical policy.

## Review Rule

Review must flag instruction drift.

Flag:

- vague abstractions without definitions
- long prose where structure fits better
- duplicated policy
- unclear authority
- missing clarification before implementation
- assumptions treated as facts
- sections with no purpose, contract, usage, failure mode, validation, or next link
- harness files copying policy instead of pointing to it
- UI copy that explains instead of naming state and action

## Validation Rule

Run the narrowest relevant check after changes.

Use repo-local validators when present. Do not invent global commands.

When documentation or instruction surfaces change, validate relevant links and references.

## Core Workflow

| Step | Rule |
|---|---|
| Bootstrap | Load harness instructions, then repo-local canonical entrypoint, then the smallest relevant canonical node. |
| Discovery | Read before deciding. |
| Clarification | Ask before crossing unclear decision boundaries. |
| Planning | Make the plan decision-complete. |
| Implementation | Edit in small verifiable steps. |
| Review | Check correctness, scope, drift, and evidence. |
| Validation | Run the smallest useful proof. |

## External Practices

- [Google Developer Documentation Style Guide](https://developers.google.com/style/highlights) — clear, precise language and active voice.
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/word-choice/use-simple-words-concise-sentences) — simple words and concise sentences.
- [Diátaxis](https://diataxis.fr/) — separate tutorials, how-to guides, reference, and explanation instead of mixing doc purposes.

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
- `implementation-handoff` — Executor-ready brief for another session or model
- `implementation-review` — Post-edit review before handoff
- `spec-dev` — Spec-driven router for spec-first, spec-anchored, and spec-as-source work
- `spec-authoring` — Durable spec authoring under `docs/specs/<spec-slug>/spec.md`
- `spec-review` — Adversarial spec review before implementation planning
- `security` — Targeted security review for vulnerabilities LLMs commonly miss (secrets in git, auth bypass, dependency confusion, path traversal, cookie security, injection)
- `project-conventions-governance` — Repo conventions and governance
- `commit-check-setup` — Bootstrap or update commit-check infrastructure in a repo. Copies scripts, generates `.copilot/commit-checks.json` config, runs smoke test. Use when setting up a repo for use with Elegy Copilot UI.
- `ui-system` — Build UI from the existing codebase. Inventory components, primitives, icons, tokens, and stories before creating new UI; treat Figma / Storybook MCP data as context, not authority.
- `elegy-obsidian` — Foundation skill for read/write/search operations against a local Obsidian vault via the official Obsidian Desktop CLI (v1.12+). Non-authoritative mirror; durable planning state stays in `elegy-planning`.

See the [Lane Agents](#lane-agents) section for lane selection, agent profiles, and escalation rules.

Use ADRs only for key architectural, workflow-authority, trust-boundary, or long-lived contract decisions. Do not create ADRs for ordinary local implementation choices.

Durable repo specs default to `docs/specs/<spec-slug>/spec.md` with optional `docs/specs/index.md`.
Follow `docs/system/spec-driven-development.md` in the Instruction Engine repo when a target repo opts into spec-driven work, and run the target repo's `node scripts/validate-specs.js <spec-root>` validator when present.

## Instruction Engine Repo Map

When the current workspace is Instruction Engine / Elegy Copilot:

- `engine-assets/` ships Copilot agents, skills, prompts, and global instructions into `~/.elegy`.
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
- **Spec required:** Yes — durable spec under `docs/specs/<slug>/spec.md`
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
- **Skills:** Load `elegy-planning`, `worktree`, `implementation-review`, `rubberduck-plan-review`

### Provider Profiles

Profiles define model+provider routing for all lane agents and subagents using five task roles. Profiles are configured in `opencode-assets/profiles.json` and applied at install time or via the profile switch command.

| Role | Default (opencode-go-balanced) | Agents |
|---|---|---|
| `planning` | `opencode-go/deepseek-v4-pro` | `plan`, `standard`, `spec`, `project` |
| `implementation` | `opencode-go/deepseek-v4-flash` | `build`, `impl`, `quick` |
| `exploration` | `opencode-go/deepseek-v4-flash` | `explore`, `explorer` |
| `review` | `opencode-go/deepseek-v4-pro` | `reviewer` |
| `research` | `opencode-go/deepseek-v4-pro` | `scout` |
| `reasoningEffort` | `max` | Max reasoning effort on all DeepSeek models |

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
- `~/.elegy/repo-state/` — Durable worktree records for dashboard, executor, and session coordination

### Elegy planning state
- `~/.elegy/managed-cli/planning/` — Managed elegy-planning CLI binary

Do not block directory access prompts for these paths during normal project-lane work.
