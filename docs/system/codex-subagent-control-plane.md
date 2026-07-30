---
created: 2026-07-04
updated: 2026-07-30
category: system
status: current
doc_kind: node
id: codex-subagent-control-plane
summary: Managed Codex subagent definitions, routing policy, UI controls, and usage telemetry.
tags: [codex, agents, telemetry, control-plane]
related: [harness-asset-flow, agents-vs-skills, ui-development-governance]
---

# Codex Subagent Control Plane

Purpose: keep Sol focused on orchestration and final judgment while using
bounded subagents for parallel work, context isolation, and independent
challenge. Native Codex owns the subagent lifecycle; plugins may add a bounded
routing policy around it.

## Contract

| Owner | Responsibility |
|---|---|
| Codex main thread | Requirements, architecture, integration, final judgment |
| Codex baseline agent TOML | Role, model, effort, sandbox, prompt |
| Elegy Copilot UI | Inspect, install, update, reset, uninstall, and show usage |
| Native Codex config | `[agents]` concurrency and depth limits |
| Local telemetry | Derived usage metadata only |

Subagents are bounded delegation tools. The default route is proactive when a
task benefits from parallelism or context isolation and the packet has a clear
scope. Do not spawn for tiny, serial, unresolved, or tightly coupled work.

## Routing policy

Default mode: `governed-automatic`. Sol actively assesses safe delegation on
non-trivial tasks and delegates only when the benefit exceeds handoff cost.
The delegated-dev plugin may use `opencode-preferred` for eligible worker
tasks. Codex-native managed agents cover exploration, bounded implementation,
review, validation, and cleanup.

Apply one default cost gate: spawn a leaf only when it has a distinct
deliverable and is expected to perform about five or more meaningful tool
calls. Bypass the numeric threshold only for user-requested independent review
or the consequential strong-review triggers below. Keep smaller or uncertain
work in the parent; do not bundle trivial work merely to reach the threshold.

| Spawn | Do not spawn |
|---|---|
| Independent work can run in parallel or isolate noisy context | Tiny edit or one-file answer |
| A bounded leaf has a distinct deliverable and about five or more meaningful tool calls | Requirements are unclear |
| Independent review slices can run in parallel | Work is serial or write-conflicting |
| Test/log triage can return a short summary | Handoff is longer than doing the task inline |

Routing modes:

| Mode | Behavior |
|---|---|
| `manual` | Spawn only after explicit user request |
| `suggested` | Main agent may recommend delegation, then wait |
| `governed-automatic` | Main agent proactively delegates approved bounded work when gates match |
| `off` | Do not use managed subagents |

## Managed agents

| Agent | Default model | Effort | Sandbox | Use |
|---|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | inherited (`high`) | `read-only` | Noisy repo mapping and non-trivial investigation |
| `reviewer` | `gpt-5.6-luna` | inherited (`high`) | `read-only` | Bounded implementation review |
| `reviewer_strong` | `gpt-5.6-sol` | inherited (`high`) | `read-only` | Complex or consequential independent review |
| `worker` | `gpt-5.6-luna` | inherited (`high`) | `workspace-write` | Bounded implementation with explicit ownership |
| `test-runner` | `gpt-5.6-luna` | inherited (`high`) | `workspace-write` | Bounded validation output |
| `sweeper` | `gpt-5.6-luna` | inherited (`high`) | `workspace-write` | Bounded cleanup |

The bounded utility lane is capped to Luna and defaults to `high`, including
exploration, implementation, and routine review. `reviewer_strong` is the
explicit Sol exception for judgment-heavy review. Role files intentionally omit
`model_reasoning_effort`, so Sol may choose `xhigh` or `max` for a complex
delegation. Use `low` only for trivial discovery and `medium` only for routine
mechanical work.
There is no Spark fallback in this routing contract. The
delegated-dev plugin prefers OpenCode Workers on the user's OpenCode Go
subscription for eligible roles, while Sol remains the orchestrator.

## Review routing

Independence determines whether review should be delegated. Complexity and
consequence determine the model:

| Review | Default owner |
|---|---|
| Bounded diff correctness, regressions, conventions, request fit, missing tests | `reviewer` (Luna) |
| Complex plans, architecture, security, privacy, migrations, data-loss risk, cross-cutting changes, disputed findings | `reviewer_strong` (Sol) |
| Requirements, trade-offs, integration, final validation, approval, closure, answer | Main Sol |

Both reviewers are read-only and advisory. The main Sol verifies and
reconciles their findings.

## Native Go agents

`elegy-codex-go-agents` is a separate experimental plugin for running genuine
native Codex child sessions against OpenCode Go. It does not replace OpenCode
Workers and must not change the parent session's root `model` or
`model_provider`.

The plugin owns an isolated localhost Responses provider, fixed
`explorer_go`/`reviewer_go` variants, paired OpenAI variants, and optional
`explorer`/`reviewer` aliases. Explicit fixed variants override aliases.
Authentication is resolved per request from the existing OpenCode Go profile
store or native OpenCode auth. The selector stores only an account identifier,
so profile changes require no bridge restart and never copy API keys into Codex
TOML or bridge configuration.

Capability status:

| Capability | Status |
|---|---|
| Native child identity and isolated provider selection | Observed |
| Parent provider remains OpenAI | Observed |
| Flash/Pro text and function-call probes | Observed |
| Hot switching between existing OpenCode Go profiles | Observed |
| Full native child streaming turn | Blocked in pinned Moon Bridge adapter |

Keep aliases on the OpenAI variants until the full native streaming turn,
tool-result continuation, cancellation, and one visible fallback pass release
tests. The CLI is the v1 control surface; desktop UI controls are deferred until
that protocol gate passes.

`explorer` is one configurable agent, not a family of explorer agents. Use the
prompt mode instead:

| Mode | Use |
|---|---|
| `pattern-discovery` | Find existing conventions or similar code |
| `trace` | Follow an execution path |
| `dependency-map` | Map dependencies and reverse dependencies |
| `search` | Find references to a symbol or pattern |
| `architecture` | Map module boundaries and data flow |

## Capability truth labels

| Label | Meaning |
|---|---|
| Enforced | Codex or app setting prevents access |
| Configured | Agent TOML requests the behavior |
| Inherited | Parent Codex session may still provide it |
| Observed | Local telemetry saw usage |

MCP tool scoping is not claimed as hard isolation. Current Codex behavior can
inherit parent MCP servers into subagents. Use lean Codex profiles for
subagent-heavy sessions until Codex supports per-agent MCP exclusion.

## UI surface

Path: Codex Settings.

Tabs:

- Overview: provider, CLI, planning setup.
- Subagents: status summary, routing settings, managed global agents, project agent discovery.
- Subagent Usage: local derived run metadata.

Editable fields:

- model
- reasoning effort
- sandbox
- routing mode
- bounded-lane model and effort within the Luna cap
- the fixed Sol strong-review lane
- developer instructions

Local overrides are preserved until the user resets a managed agent.

The Subagents tab must make background delegation visible at a glance:

- managed, installed, missing, drifted, invalid, disabled, and usable counts
- native `[agents]` sync state
- routing mode and fan-out limits
- per-agent status, routing, model, effort, sandbox, and recent usage
- install/reset/save actions for managed agents
- project-scoped agents displayed read-only and separate from managed global agents

Heavy details stay behind expansion: developer instructions, capability truth
labels, raw TOML, source path, installed path, and tool-scope notes.

The Subagents tab writes routing metadata to
`~/.codex/.elegy-copilot-codex-subagents.json` and native Codex concurrency,
depth, and runtime limits to `~/.codex/config.toml`. The installer owns the
native enablement, default subagent model, and default effort:

```toml
[agents]
enabled = true
max_concurrent_threads_per_session = 6
default_subagent_model = "gpt-5.6-luna"
default_subagent_reasoning_effort = "high"
max_depth = 1
job_max_runtime_seconds = 1800
```

This policy follows OpenAI's current Codex guidance to keep requirements and
integration in the main thread, use subagents for context isolation and
parallel work, prefer bounded prompts with explicit outputs, and avoid
overlapping write-heavy scopes. See the official
[Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) and
[Best practices](https://learn.chatgpt.com/guides/best-practices) guides.

Project-scoped `.codex/agents` entries are discovery-only in the UI. Edit them
in the project repo.

## Installation authority

Instruction Engine owns the durable global policy installed at
`~/.codex/AGENTS.md`. It composes
`catalog-assets/instructions/agent-session-defaults.md` with
`codex-assets/home/AGENTS-appendix.md`; `codex-assets/home/AGENTS.md` is only a
source-tree marker and is not an install source. The CLI setup and desktop
asset installer use this same manifest-driven composition.

The managed inventory records the installed hash. A later setup run replaces
an older managed version when its current hash still matches that inventory,
but preserves a file whose hash shows a user edit. Do not duplicate this
durable policy in Codex custom instructions. Use `~/.codex/config.toml` for
model, effort, concurrency, and depth settings.

Codex loads `~/.codex/AGENTS.override.md` instead of `AGENTS.md` when the
override exists. Setup installs the managed file but reports this condition;
merge or remove the override to activate the managed global policy. A legacy
install with no trustworthy inventory remains protected as drift and requires
an explicit reset or `--force`.

## Telemetry

Source:

```text
~/.codex/state_5.sqlite
  -> thread_spawn_edges
  -> threads
  -> rollout_path JSONL
```

Persist or display:

- agent name
- model and effort
- sandbox
- parent/child thread IDs
- token counts
- tool names and counts
- completion/error flags
- OpenCode profile, profile role, model source, cost policy, write mode, and job
  identifier when present

Do not persist prompts, responses, tool arguments, or tool outputs.

## Validation

Use:

- `node scripts/validate-codex-assets.js`
- `node scripts/codex-config-patch.test.js`
- `node scripts/codex-install.test.js`
- `node --test copilot-ui/tests/codex-subagents-service.test.js copilot-ui/tests/telemetry-service.test.js`
- `npm run ui:check`
