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

OpenCode's built-in agents stay primary:

- `Build` — main execution surface
- `Plan` — planning and critique without edits
- `Explore` — read-only codebase discovery
- `Scout` — external docs and dependency research
- `General` — bounded delegated multi-step work

The custom `@code-explorer` and `@web-searcher` subagents remain compatibility aliases during the transition, but they are not the primary recommended path.
Prefer the built-in `Explore` and `Scout` agents.

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
- `lane-quick` — Quick lane: small UI tweaks and tiny bug fixes
- `lane-standard` — Standard lane: scoped features and normal bug fixes
- `lane-spec` — Spec lane: contract/API/user-facing behavior with spec-first workflow
- `lane-project` — Project lane: multi-session roadmap work with Elegy Planning
- `elegy-obsidian` — Foundation skill for read/write/search operations against a local Obsidian vault via the official Obsidian Desktop CLI (v1.12+). Non-authoritative mirror; durable planning state stays in `elegy-planning`.

See the [OpenCode Method](#opencode-method-agentic-lanes) section for lane selection, provider profiles, and escalation rules.

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

## OpenCode Method (Agentic Lanes)

The OpenCode Method provides four public lanes for matching effort to task scope. Each lane sets a default model role, optional gates, and workflow expectations.

### Lane Quick

Small UI tweaks and tiny bug fixes. Flash only; no spec or roadmap required.

- **Default model role:** `small` (DeepSeek V4 Flash)
- **Escalation:** Not needed; if scope exceeds lane bounds, recommend `standard` lane
- **Spec required:** No
- **Worktree required:** No
- **Validation:** Narrowest relevant lint/test
- **Prerequisites:** Load `lane-quick` skill

### Lane Standard

Scoped feature or normal bug fix. Flash for exploration and implementation; Pro only for ambiguity, architectural choices, or final review.

- **Default model role:** `small` (DeepSeek V4 Flash)
- **Escalation:** `big` (DeepSeek V4 Pro) for design ambiguity, architecture decisions, and final review
- **Spec required:** No (but recommended for anything that touches user-facing behavior)
- **Worktree required:** No
- **Validation:** Focused tests, lint, typecheck
- **Prerequisites:** Load `lane-standard` skill

### Lane Spec

Contract, workflow, API, or user-facing behavior changes. Requires spec-first or spec-anchored workflow. Pro for spec review and implementation plan.

- **Default model role:** `small` for implementation; `big` for spec review and planning
- **Escalation:** `review` role (defaults to `big`) gates spec review before implementation starts
- **Spec required:** Yes — durable spec under `specs/<slug>/spec.md`
- **Worktree required:** No
- **Validation:** spec validation + focused tests
- **Prerequisites:** Load `lane-spec` skill and relevant spec-dev/spec-authoring skills

### Lane Project

Multi-session roadmap work. Requires Elegy Planning goal/roadmap/work point, dedicated worktree, claim/lease, evidence, and review.

- **Default model role:** `small` for exploration and execution; `big` for gates and review
- **Escalation:** `review` role gates each work point handoff
- **Spec required:** Yes (per work point)
- **Worktree required:** Yes — use `worktree_create` with `commitBeforeDelete: true` only when explicitly committing
- **Validation:** Full evidence chain: validation expectations -> run results -> review
- **Prerequisites:** Load `lane-project` skill, Elegy Planning skills, and worktree skill

### Provider Profiles

Provider profiles define model routing across lanes. Both models use max reasoning effort at all times.

| Profile field | Default | Description |
|---|---|---|
| `small` | `DeepSeek V4 Flash` | Cheap model for exploration, implementation, and quick work |
| `big` | `DeepSeek V4 Pro` | Capable model for design review, architecture, and gates |
| `review` | `big` (same as above) | Model used for spec review, plan review, and final validation gates |
| `route` | `opencode-go` | Provider route: `opencode-go` (native) or `deepseek-direct` |

#### Max reasoning

Both DeepSeek V4 Pro and DeepSeek V4 Flash should always use maximum reasoning effort. The `reasoningEffort` option on any agent using a DeepSeek model must be set to `"high"`.

This is configured in `opencode.json` by adding `reasoningEffort` to the relevant agent configs:

```jsonc
{
  "agent": {
    "build": { "reasoningEffort": "high" },
    "plan": { "reasoningEffort": "high" },
    "explore": { "reasoningEffort": "high" },
    "scout": { "reasoningEffort": "high" }
  }
}
```

Any custom agent using a DeepSeek model should also include `"reasoningEffort": "high"`. The Copilot UI config preview validates that this option is present on all DeepSeek-configured agents.

(Note: `profiles` and `lanes` in the plan spec are a conceptual contract for the UI — they are NOT top-level keys in `opencode.json`. The actual OpenCode config uses `model`, `small_model`, and per-agent overrides with the `reasoningEffort` pass-through option.)

#### Recommended defaults

- **Default profile:** OpenCode Go route
- **Fallback profile:** Direct DeepSeek route
- **Lane-to-role mapping:**
  - `quick` → `small` only
  - `standard` → `small` (default), `big` on escalation triggers
  - `spec` → `small` (implementation), `review` at spec/plan gates
  - `project` → `small` (execution), `review` at each work point gate

#### Config example

In `opencode.json` (user-local, managed via `/connect`):

```jsonc
{
  "model": "deepseek/deepseek-v4-pro",
  "small_model": "deepseek/deepseek-v4-flash",
  "agent": {
    "build": { "reasoningEffort": "high" },
    "plan": { "reasoningEffort": "high" },
    "explore": {
      "model": "deepseek/deepseek-v4-flash",
      "reasoningEffort": "high"
    },
    "scout": {
      "model": "deepseek/deepseek-v4-flash",
      "reasoningEffort": "high"
    }
  }
}
```

Use `/connect` in OpenCode TUI to set provider credentials. The UI stores provider/model IDs and profile metadata, not API keys.

### Lane Skill Loading

Load the lane skill matching your intent before starting work:

- `lane-quick` — Quick fixes and small UI tweaks
- `lane-standard` — Scoped features and normal bug fixes
- `lane-spec` — Spec-driven contract/API work
- `lane-project` — Multi-session roadmap work with Elegy Planning

Each lane skill validates prerequisites, sets workflow expectations, and provides execution prompts tailored to the lane.

## Boundaries

- Keep this global file workflow-specific, not repo-specific.
- Put build commands, test commands, and local conventions in repo-local AGENTS.md only when a repo actually needs them.
- Use OpenCode `/init` only when repo-local guidance actually needs to be created or refreshed.
- Do not recreate Copilot orchestration or session-state workflows in OpenCode.
- Do not change git branches unless explicitly asked.
- Do not commit secrets or credentials.
