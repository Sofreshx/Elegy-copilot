# 🤖 Instruction Engine

> Structured Copilot agent orchestration for multi-repo development.

[![Copilot Compatible](https://img.shields.io/badge/Copilot-Compatible-blue?logo=github)](https://docs.github.com/en/copilot)

Instruction Engine provides shared agents, skills, templates, and workflow conventions that can be reused across repositories. It is designed to keep planning, execution, testing, and task memory consistent when working with GitHub Copilot Chat.

## What lives here

### Core engine assets

- `.github/agents/` — custom agents (executive, testing, security, infra, review)
- `.github/skills/` — domain skills (`SKILL.md` per skill)
- `.github/templates/` — task/progress and hook templates
- `.github/copilot-instructions.md` — shared operating rules used across repos

### Runtime/tooling components

- `vscode-skill-installer/` — VS Code extension (Instruction Engine host)
- `cloud-relay/` — relay service for remote/mobile connectivity
- `mobile-companion/` — web companion client
- `local-tracker/` — local daemon for session/task tracking

## Quick start

### 1) Add the engine to your workspace

```bash
git submodule add https://github.com/Sofreshx/instruction-engine.git instruction-engine
```

Or copy `.github/` into your target repo if you do not want a submodule.

### 2) Enable subagent delegation in VS Code

```json
{
  "chat.customAgentInSubagent.enabled": true
}
```

### 3) Initialize project-local memory/task structure

In Copilot Chat, run:

```text
Initialize this project by creating the .instructions structure for tasks, architecture, and contexts.
```

Typical project-local folders:

- `.instructions/tasks/`
- `.instructions/tasks.archive/`
- `.instructions/tasks.history.md`
- `.instructions/architecture.md`
- `.instructions/contexts/`

### 4) Recommended `.gitignore`

```gitignore
# Instruction Engine session RAM (developer-local)
.instructions/active-tasks.md

# Instruction Engine generated outputs (developer-local)
.instructions-output/
```

## Execution patterns

- **Fast execution:** `@executive2-fast` (no durable task graph)
- **Durable execution:** `@executive2-planner` → `@executive2` (task graph + progress tracker)
- **Task creation:** `@addtodo`
- **Validation/testing:** `@unit-test-runner`, `@integration-test-runner`, `@testing-executive`
- **Quality/security:** `@code-reviewer`, `@issue-audit-executive`, `@security-scanner`, `@security-fixer`

## Current inventory (repo snapshot)

As of this README update:

- 47 custom agent definitions in `.github/agents/*.agent.md`
- 48 skills in `.github/skills/*/SKILL.md`

To re-check counts locally:

```bash
find .github/agents -maxdepth 1 -name '*.agent.md' | wc -l
find .github/skills -mindepth 1 -maxdepth 1 -type d | wc -l
```

## Repository layout

```text
instruction-engine/
├── .github/
│   ├── agents/
│   ├── skills/
│   ├── templates/
│   └── copilot-instructions.md
├── .instructions/           # this repo's own task/context memory
├── .instructions-output/    # generated artifacts/logs
├── docs/
├── cloud-relay/
├── local-tracker/
├── mobile-companion/
└── vscode-skill-installer/
```

## Documentation

- [Agents vs Skills](docs/agents-vs-skills.md)
- [Agent Architecture Simplicity](docs/agent-architecture-simplicity.md)
- [Agent Hooks](docs/agent-hooks.md)
- [Skills Governance](docs/skills-governance.md)
- [MCP Workflow](docs/mcp-workflow.md)
- [E2E Setup Guide](docs/e2e-setup-guide.md)
- [E3 DB Reliability](docs/e3-db-reliability.md)
- [E3 VM Isolation](docs/e3-vm-isolation.md)
- [Relay API Reference](docs/relay-api-reference.md)
- [Relay Deployment](docs/relay-deployment.md)
- [Mobile Companion Setup](docs/mobile-companion-setup.md)
- [Mobile Local Testing](docs/mobile-local-testing.md)
- [Security Model](docs/security-model.md)
- [Instruction Changelog](docs/instruction-changelog.md)

## Contributing

1. Add/update agent files in `.github/agents/`.
2. Add/update skills in `.github/skills/<skill>/SKILL.md`.
3. Keep shared operating guidance in `.github/copilot-instructions.md` concise and stable.
4. Update docs under `docs/` when behavior/workflows change.
