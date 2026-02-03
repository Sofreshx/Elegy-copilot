# 🤖 Instruction Engine

> **A structured agent orchestration system for GitHub Copilot Chat**

[![Copilot Compatible](https://img.shields.io/badge/Copilot-Compatible-blue?logo=github)](https://docs.github.com/en/copilot)
[![Agents & Skills](https://img.shields.io/badge/Agents_%26_Skills-blue)](/.codex/skills)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## What is this?

Instruction Engine is a **workspace model** that extends GitHub Copilot Chat with:

- 🎯 **20 Executive & Utility Agents** - High-level task routing and specialized roles (planner, debugger, merger, onboarding, etc.)
- 🛠️ **36 Skill Agents** - Domain-specific capabilities (ASP.NET, React, Firebase, Terraform, etc.)
- 📋 **Task Pipeline** - Structured planning → execution → maintenance loop
- 🧠 **Project Memory** - Lessons learned, patterns, and warnings persist across sessions

## Quick Start

### 1. Add to Your Project

Copy the `.github/` folder to your project (optional: include `.codex/` for browsable reference docs), or add this repo as a submodule:

```bash
git submodule add https://github.com/Sofreshx/instruction-engine.git instruction-engine
```

### 2. Initialize Your Project

In VS Code Copilot Chat:
```
@onboarding Initialize this project
```

This creates your `.instructions/` folder with:
- `tasks/` - One task per file (with attempts/failures as durable memory)
- `architecture.md` - Project structure
- `project.index.md` - Active skills registry
- `contexts/` - Patterns and memory

### 2.1 Recommended `.gitignore`

Tasks are meant to be tracked in git now (so teams can collaborate and resume work).
The only common developer-local items are session RAM and generated outputs:

```gitignore
# Instruction Engine session RAM (developer-local)
.instructions/active-tasks.md

# Instruction Engine generated outputs (developer-local)
.instructions-output/
```

### 3. Start Using

| Example | Uses | Purpose |
|---------|------|---------|
| "Plan this feature" | Plan Mode or `@executive2-planner` | Produce a structured plan before edits |
| "Archive completed tasks" | `system-cleanup` skill | Move done task files to `tasks.archive/` and append to `tasks.history.md` |
| `@helper How does X work?` | Custom agent | Explanations (read-only) |
| `@e2e-ux-auditor Run an E2E UX audit` | Custom agent + `@playwright/mcp` | Drive a browser, report UX/feature gaps, sync to tasks |
| `@debugger Why is this failing?` | Custom agent | Investigate errors |
| `@auditor Check security` | Custom agent | Run quality/security scans |

### Executive2 (Composable Workflow)

Executive2 supports two clean “start implementing” paths:

- **Fast path (no persistence):**
  - `@executive2-planner` (plan only) → `@executive2-fast` (implement directly, no `.instructions/` state)

- **Task-graph path (durable execution):**
  - `@executive2-planner` (plan only) → `@executive2-task-creator` (create `.instructions/tasks/*`) → `@executive2` (orchestrate via `task-runner`)

Agent roles:
- `@executive2-planner`: planning only (goal/acceptance criteria/plan). Does not create tasks unless explicitly requested.
- `@executive2-task-creator`: converts an approved plan into persisted `.instructions/tasks/*` (and optionally a plan artefact for complex work).
- `@executive2`: orchestration-only. Requires an existing task graph and delegates execution to `task-runner`, testing to `test-executive`, and governance review to `code-reviewer`.
- `@executive2-fast`: implements directly with good judgment, but never persists `.instructions/` state.

Optional subagents:
- `@research-ideation`: research and ideation notes under `.instructions/research/` (no code design/implementation).
- `@reviewer-gpt-5-2-codex` / `@reviewer-opus-4-5`: cross-model accuracy checks for plans and execution summaries.

### Hiding Internal Agents (Copilot UI)

Most non-executive agents in `.github/agents/` are meant to be invoked as **subagents** by the executive agents.
VS Code’s agent picker hiding is currently **per-user**, so this repo uses a convention:

- Agent frontmatter includes `role:` and `visibility:`.
- Internal-only agents use `visibility: internal`.

Recommended: use VS Code “Configure Custom Agents” to hide internal agents from the picker.

## Architecture

```
instruction-engine/.github/          # Global Engine (shared)
├── copilot-instructions.md          # Shared guidance (global conventions)
├── agents/                          # Optional custom agents
│   ├── assistant.agent.md           # @helper
│   ├── debugger.agent.md            # @debugger
│   ├── auditor.agent.md             # @auditor
│   ├── onboarding.agent.md          # @onboarding
│   ├── skill-builder.agent.md       # @skill-builder
│   └── merger.agent.md              # @merger
├── skills/                          # Skills (Copilot loads from here)
├── templates/                       # Project scaffolding
└── patterns/                        # Reusable patterns

instruction-engine/.codex/           # Reference docs (mirrors / indexes)
└── skills/                          # Skill index + reference copies

your-project/.instructions/          # Local Project (per-repo)
├── project.index.md                 # Active skills registry
├── tasks/                           # One task per file
├── tasks.archive/                   # Archived completed tasks
├── tasks.history.md                 # Append-only recap log
├── architecture.md                  # Project overview
├── research/                        # Research notes and ideation outputs
└── contexts/                        # Project-specific knowledge
  └── project.memory.md            # Lessons, gotchas, active warnings/risks
```

## The Loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. PLAN: Plan Mode + planner agents                          │
├─────────────────────────────────────────────────────────────┤
│  2. IMPLEMENT: Default agent + subagents as needed            │
├─────────────────────────────────────────────────────────────┤
│  3. REVIEW: governance + quality review                        │
├─────────────────────────────────────────────────────────────┤
│  4. ORGANIZE: cleanup agents keep backlog tidy                │
└─────────────────────────────────────────────────────────────┘
```

## Available Skills

This repository currently includes skills under `.codex/skills/` (see `.codex/skills/index.md` for a full list).

### Core Development
`feature-creator` · `frontend` · `refactor` · `migration`

### Auth & Security  
`auth` · `firebase-auth` · `security` · `secrets-auditor`

### Quality & Testing
`testing` · `code-review` · `csharp-expert` · `quality-typescript` · `performance`

### Infrastructure
`terraform` · `deployment-compose` · `cloudflare-storage`

### .NET Ecosystem
`aspire-apphost` · `aspire-deployment` · `wolverine-core` · `wolverine-http` · `marten-documents` · `marten-events` · `orleans` · `signalr`

### AI/ML
`semantic-kernel-agents` · `openai-api` · `ms-agent-framework`

[View all skills →](/.codex/skills/index.md)

## Copilot Integration

This system is designed to work **with** GitHub Copilot, not against it:

- ✅ All agents have `description:` for auto-routing
- ✅ Runner uses `runSubagent` tool to delegate to skills
- ✅ Skills can't spawn subagents (enforced via `tools:`)
- ✅ Destructive agents marked `infer: false`
- ✅ Follows official [custom agents spec](https://code.visualstudio.com/docs/copilot/customization/custom-agents)

### Required Settings

To enable skill subagent delegation, add this to your VS Code `settings.json`:

```json
{
  "chat.customAgentInSubagent.enabled": true
}
```

> ⚠️ **Experimental**: This setting enables custom agents to be invoked as subagents. Without it, the runner cannot delegate tasks to skill agents.

## Documentation

- [Installation Guide](INSTALLATION_GUIDE.md)
- [Upgrade Guide](UPGRADE_GUIDE.md)  
- [Example Workflow](EXAMPLE_WORKFLOW.md)
- [Lazy Loading Pattern](.github/patterns/lazy-loading.pattern.md)
- [Skill Index](.codex/skills/index.md)
- [E2E Setup Guide](docs/e2e-setup-guide.md)

## Contributing

1. Fork this repository
2. Create a skill in `.codex/skills/`
3. Follow the [agent schema](#agent-schema)
4. Submit a PR

### Agent Schema

Skills follow the [GitHub Copilot Agent Skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) specification:

```yaml
---
name: my-skill
description: "What this skill does. Use this when asked to do X, Y, or Z."
---

# Skill Name

## When NOT to Use
- For X → use `other-skill`

## Purpose
...
```

> **Note**: The `tools:` and `sources:` fields are NOT part of the GitHub spec. Skills are matched by `description` keywords.

## License

MIT © [Sofreshx](https://github.com/Sofreshx)
