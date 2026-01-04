# 🤖 Instruction Engine

> **A structured agent orchestration system for GitHub Copilot Chat**

[![Copilot Compatible](https://img.shields.io/badge/Copilot-Compatible-blue?logo=github)](https://docs.github.com/en/copilot)
[![Agents & Skills](https://img.shields.io/badge/Agents_%26_Skills-blue)](/.github/skills)
[![License](https://img.shields.io/badge/License-MIT-yellow)](LICENSE)

## What is this?

Instruction Engine is a **workspace model** that extends GitHub Copilot Chat with:

- 🎯 **20 Executive & Utility Agents** - High-level task routing and specialized roles (planner, debugger, merger, onboarding, etc.)
- 🛠️ **36 Skill Agents** - Domain-specific capabilities (ASP.NET, React, Firebase, Terraform, etc.)
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

### 2.1 Add `.instructions` task files to `.gitignore`

These are developer-local and will cause churn/merge conflicts if committed:

```gitignore
# Instruction Engine task pipeline (developer-local)
.instructions/tasks.md
.instructions/raw.tasks.md

# Instruction Engine generated outputs (developer-local)
.instructions-output/
```

### 3. Start Using

| Example | Uses | Purpose |
|---------|------|---------|
| "Plan this feature" (Plan Mode) | Plan Mode + `planning-feature` skill | Produce a structured plan before edits |
| "Organize `.instructions/tasks.md`" | `project-management` skill | Triage/prioritize the backlog |
| `@helper How does X work?` | Custom agent | Explanations (read-only) |
| `@debugger Why is this failing?` | Custom agent | Investigate errors |
| `@auditor Check security` | Custom agent | Run quality/security scans |

## Architecture

```
instruction-engine/.github/          # Global Engine (shared)
├── copilot-instructions.md          # Shared guidance (skills-first)
├── agents/                          # Optional custom agents
│   ├── assistant.agent.md           # @helper
│   ├── debugger.agent.md            # @debugger
│   ├── auditor.agent.md             # @auditor
│   ├── onboarding.agent.md          # @onboarding
│   ├── skill-builder.agent.md       # @skill-builder
│   └── merger.agent.md              # @merger
├── skills/                          # Shared/reference skills (copy into repo for auto-load)
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
│  1. PLAN: Plan Mode + planning skills                        │
├─────────────────────────────────────────────────────────────┤
│  2. IMPLEMENT: Default agent + repo skills                   │
├─────────────────────────────────────────────────────────────┤
│  3. ORGANIZE: project-management skill keeps backlog tidy    │
└─────────────────────────────────────────────────────────────┘
```

## Available Skills

This repository currently includes **36** skills under `.github/skills/` (see `.github/skills/index.md` for a full list).

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
