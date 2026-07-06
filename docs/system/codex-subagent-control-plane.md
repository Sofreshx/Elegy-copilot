---
created: 2026-07-04
updated: 2026-07-04
category: system
status: current
doc_kind: node
id: codex-subagent-control-plane
summary: Managed Codex subagent definitions, routing policy, UI controls, and usage telemetry.
tags: [codex, agents, telemetry, control-plane]
related: [harness-asset-flow, agents-vs-skills, ui-development-governance]
---

# Codex Subagent Control Plane

Purpose: manage Codex subagents without making delegation automatic, opaque, or expensive.

## Contract

| Owner | Responsibility |
|---|---|
| Codex main thread | Requirements, architecture, integration, final judgment |
| Managed subagent TOML | Role, model, effort, sandbox, prompt |
| Elegy Copilot UI | Inspect, install, update, reset, uninstall, and show usage |
| Native Codex config | `[agents]` concurrency and depth limits |
| Local telemetry | Derived usage metadata only |

Subagents are explicit delegation tools. They are not background workers.

## Routing policy

Default mode: manual.

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
| `explorer` | `gpt-5.4-mini` | `low` | `read-only` | Noisy repo mapping |
| `reviewer` | `gpt-5.5` | `high` | `read-only` | Independent review |
| `sweeper` | `gpt-5.4-mini` | `medium` | `workspace-write` | Bounded cleanup |

`explorer` also records `gpt-5.3-codex-spark` as an optional fast lane when
the user has Codex Pro access and the task is shallow read-only exploration.

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
- Subagents: routing settings, managed global agents, project agent discovery.
- Subagent Usage: local derived run metadata.

Editable fields:

- model
- reasoning effort
- sandbox
- routing mode
- Spark fast-lane toggle
- developer instructions

Local overrides are preserved until the user resets a managed agent.

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

Do not persist prompts, responses, tool arguments, or tool outputs.

## Validation

Use:

- `node scripts/validate-codex-assets.js`
- `node scripts/codex-config-patch.test.js`
- `node scripts/codex-install.test.js`
- `node --test copilot-ui/tests/codex-subagents-service.test.js copilot-ui/tests/telemetry-service.test.js`
- `npm run ui:check`
