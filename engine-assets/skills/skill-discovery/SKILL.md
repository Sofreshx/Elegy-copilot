---
name: skill-discovery
description: "Dynamic skill discovery and resolution for the search/execute pattern. Teaches agents how to find, search, and load domain-specific skills from the vault instead of relying on always-loaded context. Use this when you need to find which skill applies to a task, resolve a pointer skill, or search the skill vault by keyword. Triggers on: find skill, which skill, search skills, discover skill, load skill, skill vault, pointer skill, resolve skill, skill for this task."
---

# Skill Discovery

## Purpose

Most domain-specific skills are stored in the **skill vault** (`~/.copilot/skills-vault/`) and are NOT loaded into agent context by default. This keeps token usage low. When you need domain-specific knowledge, use this skill's patterns to find and load the right skill on demand.

## Architecture

```
~/.copilot/
├── skills/                    ← VS Code scans this (always-loaded, few items)
│   ├── skill-discovery/       ← THIS skill (meta)
│   ├── core-guardrails/       ← Safety rules
│   ├── implementation-friction/← Code quality feedback
│   └── stack-detector/        ← Project tech detection
│
└── skills-vault/              ← NOT scanned by VS Code (on-demand, many items)
    ├── firebase-auth/SKILL.md
    ├── wolverine-core/SKILL.md
    ├── marten-documents/SKILL.md
    └── ... (30+ domain skills)
```

## Discovery Patterns

### Pattern 1: Stack Detection (project-wide)

When starting work on a new project or when the tech stack is unclear, use `stack-detector`:

1. Load and follow the `stack-detector` skill (always available in `~/.copilot/skills/`)
2. It scans project files (`.csproj`, `package.json`, `*.tf`, etc.)
3. Returns a list of relevant skill names
4. Load each skill from the vault using Pattern 3

### Pattern 2: Keyword Search (task-specific)

When you know what domain you need (e.g., "I need to write a Wolverine endpoint"):

1. Identify keywords from the task: `wolverine`, `endpoint`, `HTTP handler`
2. Look for a matching skill in `~/.copilot/skills-vault/` by listing the directory
3. Read the target `SKILL.md`: `~/.copilot/skills-vault/{skill-name}/SKILL.md`

Common keyword → skill mappings:
- Firebase, auth, ID token → `firebase-auth`
- Wolverine, message handler, CQRS → `wolverine-core`
- Wolverine endpoint, HTTP handler → `wolverine-http`
- Marten, document store → `marten-documents`
- Marten, event sourcing → `marten-events`
- Marten, LINQ → `marten-linq-querying`
- Orleans, grain, virtual actor → `orleans`
- SignalR, real-time, WebSocket → `signalr`
- Aspire, AppHost → `aspire-apphost`
- Aspire, deploy → `aspire-deployment`
- React Query, useQuery → `react-query`
- Terraform, IaC → `terraform`
- Docker, compose → `deployment-compose`
- xUnit, NSubstitute, unit test (.NET) → `testing-dotnet-unit`
- Vitest, React Testing Library → `testing-frontend-unit`
- Alba, integration test → `alba-integration-tests`
- OpenTelemetry, logging, Grafana → `logging-observability`
- OpenAI, GPT, chat completion → `openai-compatible`
- Semantic Kernel, SK agents → `semantic-kernel-agents`
- Microsoft Agent Framework → `microsoft-agent-framework`
- C#, .NET, ASP.NET → `csharp-expert`
- React, Vue, frontend UI → `frontend`
- Security, OWASP, vulnerability → `security`
- Code review, PR review → `code-review`
- Refactor, restructure → `refactor`
- Debug, investigate → `debug`
- Architecture, design, ADR → `design`
- Plan feature, break down → `planning-feature`
- Plan pack, plan authoring → `planpack-authoring`
- Audit report, finding format → `audit-report-formats`
- Stack audit, pattern check → `stack-audit-patterns`
- E2E, browser automation → `e2e-workflow`
- Agent browser CLI → `agent-browser`
- Playwright MCP → `playwright-mcp`
- Instruction quality → `instruction-quality`
- Test caching → `test-caching-verification`

### Pattern 3: Direct Load (known skill name)

When you already know the skill name:

```
read_file("~/.copilot/skills-vault/{skill-name}/SKILL.md")
```

Replace `~/.copilot` with the actual Copilot home path if `XDG_CONFIG_HOME` is set.

## Resolution Rules

1. **Always-loaded skills** (`~/.copilot/skills/`): Already in your context — just follow them.
2. **On-demand skills** (`~/.copilot/skills-vault/`): Must be explicitly loaded via `read_file` when needed.
3. **If a skill doesn't exist in the vault**: The skill is not installed. Proceed with general knowledge — do not hallucinate skill content.
4. **Load skills lazily**: Only load a skill when you actually need its domain-specific guidance for the current task. Don't pre-load everything.
5. **One skill at a time**: Load the most specific skill first. If it references other skills, load those as needed.

## When to Use This Skill

- **Starting a new task**: Check if the task involves a specific framework/library → search vault
- **Delegating to subagents**: Include the resolved skill content in the subagent prompt
- **Stack detection returned skill names**: Load each from vault before implementing
- **Agent instructions say "load skill X"**: Resolve from vault, not from the always-loaded set
- **Encountering unfamiliar patterns**: Search vault by keyword for relevant guidance
