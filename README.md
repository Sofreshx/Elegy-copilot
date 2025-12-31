# 🤖 Instruction Engine

> **A structured agent orchestration system for GitHub Copilot Chat**

[![Copilot Compatible](https://img.shields.io/badge/Copilot-Compatible-blue?logo=github)](https://docs.github.com/en/copilot)
[![Agents](https://img.shields.io/badge/Agents-46-green)](/.github/skills)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## What is this?

Instruction Engine is a **workspace model** that extends GitHub Copilot Chat with:

- 🎯 **8 Executive Agents** - High-level task routing (planner, runner, debugger, merger, etc.)
- 🛠️ **38 Skill Agents** - Domain-specific capabilities (.NET, React, Firebase, Terraform, etc.)
- 📋 **Task Pipeline** - Structured planning → execution → maintenance loop
- 🧠 **Project Memory** - Lessons learned, patterns, and warnings persist across sessions

## Quick Start

### 1. Add to Your Project

Copy the `.github/` folder to your project, or add this repo as a submodule:

```bash
git submodule add https://github.com/Sofreshx/instruction-engine.git instruction-engine
```

### 2. Initialize Your Project

In VS Code Copilot Chat:
```
@onboarding Initialize this project
```

This creates your `.instructions/` folder with:
- `tasks.md` - Your task backlog
- `architecture.md` - Project structure
- `project.index.md` - Active skills registry
- `contexts/` - Patterns and memory

### 3. Start Using

| Command | Agent | Purpose |
|---------|-------|---------|
| `@planner Create a plan for X` | Planner | Break down features into tasks |
| `@runner Run task T-001` | Runner | Execute a task from backlog |
| `@helper How does X work?` | Helper | Get explanations (read-only) |
| `@debugger Why is this failing?` | Debugger | Investigate errors |
| `@auditor Check security` | Auditor | Run quality/security scans |

## Architecture

```
instruction-engine/.github/          # Global Engine (shared)
├── copilot-instructions.md          # Kernel - routes requests
├── agents/                          # Executive agents
│   ├── project-planner.agent.md     # @planner
│   ├── task-runner.agent.md         # @runner  
│   ├── assistant.agent.md           # @helper
│   ├── debugger.agent.md            # @debugger
│   ├── auditor.agent.md             # @auditor
│   ├── onboarding.agent.md          # @onboarding
│   ├── skill-builder.agent.md       # @skill-builder
│   └── skills/                      # 37 domain skills
├── templates/                       # Project scaffolding
└── patterns/                        # Reusable patterns

your-project/.instructions/          # Local Project (per-repo)
├── project.index.md                 # Active skills registry
├── tasks.md                         # Task backlog
├── architecture.md                  # Project overview
├── warnings.md                      # Active risks
└── contexts/                        # Project-specific knowledge
```

## The Loop

```
┌─────────────────────────────────────────────────────────────┐
│  1. PLAN: @planner → Creates tasks in .instructions/tasks.md │
├─────────────────────────────────────────────────────────────┤
│  2. RUN:  @runner T-001 → Executes task using skill agents   │
├─────────────────────────────────────────────────────────────┤
│  3. MAINTAIN: @onboarding → Archives done, cleans up         │
└─────────────────────────────────────────────────────────────┘
```

## Available Skills

### Core Development
`feature-creator` · `frontend` · `refactor` · `migration`

### Auth & Security  
`auth` · `firebase-auth` · `security` · `secrets-auditor`

### Quality & Testing
`testing` · `code-review` · `quality-csharp` · `quality-typescript` · `performance`

### Infrastructure
`terraform` · `deployment-compose` · `cloudflare-storage`

### .NET Ecosystem
`aspire-apphost` · `aspire-deployment` · `wolverine-core` · `wolverine-http` · `marten-documents` · `marten-events` · `orleans` · `signalr`

### AI/ML
`semantic-kernel-agents` · `openai-api` · `ms-agent-framework`

[View all skills →](/.github/skills/index.md)

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
- [Skill Index](.github/skills/index.md)

## Contributing

1. Fork this repository
2. Create a skill in `.github/skills/`
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
