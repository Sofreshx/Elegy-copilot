---
created: 2026-07-04
updated: 2026-07-11
category: system
status: current
doc_kind: node
id: codex-subagent-control-plane
summary: Managed Codex subagent definitions, routing policy, UI controls, and usage telemetry.
tags: [codex, agents, telemetry, control-plane]
related: [harness-asset-flow, agents-vs-skills, ui-development-governance]
---

# Codex Subagent Control Plane

Purpose: manage Codex subagents without making delegation needless, opaque, or
expensive. Native Codex owns the subagent lifecycle; plugins may add a bounded
routing policy around it.

## Contract

| Owner | Responsibility |
|---|---|
| Codex main thread | Requirements, architecture, integration, final judgment |
| Codex baseline agent TOML | Role, model, effort, sandbox, prompt |
| Elegy Copilot UI | Inspect, install, update, reset, uninstall, and show usage |
| Native Codex config | `[agents]` concurrency and depth limits |
| Local telemetry | Derived usage metadata only |

Subagents are explicit delegation tools. They are not background workers. A
plugin-scoped automatic route is allowed only when the plugin is active, the
task benefits from context/token isolation, and the packet has a bounded scope.
Do not spawn for tiny or tightly coupled work.

## Routing policy

Default mode: manual. The delegated-dev plugin may use `opencode-preferred`
for eligible worker tasks and fall back to these Codex-native agents.

| Spawn | Do not spawn |
|---|---|
| User asks for subagents, delegation, or parallel work | Tiny edit or one-file answer |
| Read-only exploration would create about five or more noisy tool calls | Requirements are unclear |
| Independent review slices can run in parallel | Work is serial or write-conflicting |
| Test/log triage can return a short summary | Handoff is longer than doing the task inline |

Routing modes:

| Mode | Behavior |
|---|---|
| `manual` | Spawn only after explicit user request |
| `suggested` | Main agent may recommend delegation, then wait |
| `governed-automatic` | Main agent may use approved read-only delegation when gates match |
| `off` | Do not use managed subagents |

## Managed agents

| Agent | Default model | Effort | Sandbox | Use |
|---|---|---|---|---|
| `explorer` | `gpt-5.6-luna` | `low` | `read-only` | Noisy repo mapping |
| `worker` | `gpt-5.6-luna` | `high` | `workspace-write` | Bounded implementation |
| `worker-hard` | `gpt-5.6-luna` | `max` | `workspace-write` | Complex bounded implementation |
| `reviewer` | `gpt-5.6-luna` | `high` | `read-only` | Independent review |
| `test-runner` | `gpt-5.6-luna` | `medium` | `workspace-write` | Bounded validation output |
| `sweeper` | `gpt-5.6-luna` | `medium` | `workspace-write` | Bounded cleanup |

The baseline native lane is capped to Luna and `low`/`medium`/`high`/`max`.
There is no Spark or higher-effort fallback in this routing contract. The
delegated-dev plugin prefers OpenCode Workers on the user's OpenCode Go
subscription for eligible roles, while Sol remains the orchestrator.

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
- baseline model and effort within the Luna cap
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
`~/.codex/.elegy-copilot-codex-subagents.json` and native Codex fan-out limits
to `~/.codex/config.toml`:

```toml
[agents]
max_threads = 3
max_depth = 1
job_max_runtime_seconds = 1800
```

Project-scoped `.codex/agents` entries are discovery-only in the UI. Edit them
in the project repo.

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
