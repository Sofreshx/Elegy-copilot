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

- `RannIA/` — VS Code extension (Instruction Engine host)
- `local-tracker/` — local daemon for session/task tracking

## Discord remote control (Messaging Gateway)

Run Copilot agent sessions from Discord and stream session updates back into a Discord thread.

**How it works (local-only):**
- Discord → `local-tracker` Messaging Gateway
- Messaging Gateway → VS Code extension (RannIA) over `ws://127.0.0.1:<port>`
- Extension → Copilot Chat (invokes `@orchestrator`, reports session events)

### Prerequisites
- Node.js (for `local-tracker`)
- VS Code with the RannIA extension installed/running
- A Discord bot token + a server (guild) where the bot is installed
- Discord IDs (numeric): guild ID, channel ID, allowlisted user IDs

### Setup (recommended path)

0) **Create a Discord bot + gather IDs**
- Create a Discord application + bot in the Discord Developer Portal
- Install the bot into your guild (server)
- Enable Discord **Developer Mode** and copy the numeric IDs you’ll need:
  - Guild ID, Channel ID, your User ID

1) **Enable the extension WebSocket server**
- In VS Code settings set `skillInstaller.ws.enabled` to `true`
- Reload VS Code
- When the WS server starts it writes `<workspaceRoot>/.skill-installer/ws-port.txt`

2) **Create the gateway config**
- Run VS Code command: **Gateway: Setup Messaging Gateway**
- This creates/updates: `~/.instruction-engine/messaging-gateway.config.json`
- Ensure it contains:
  - `discord.allowlistedUserIds` (your Discord user ID(s))
  - `discord.guildId`, `discord.channelId`
  - `workspaces.allowedRoots` (absolute paths), `workspaces.activeRoot`

3) **Store secrets in OS credential store**
- Run: **Gateway: Store Discord Bot Token (Keychain)**
- Run: **Gateway: Store Extension WS JWT (Keychain)** (defaults `sub=gateway`)

4) **Start the Messaging Gateway**
```bash
cd local-tracker
npm install
npm run build
npm run start:gateway -- --mode connected
```

For a deeper reference (config fields, auth model, troubleshooting), see `local-tracker/docs/messaging-gateway.md`.

### Using it from Discord
- `/status` — gateway + extension connection status
- `/sessions` — list recent sessions (connected mode)
- `/task prompt:<text>` — run work via `@orchestrator` (creates a thread + streams updates)
- `/plan prompt:<text>` — plan-only via `@orchestrator`
- `/stop sessionid:<id>` — cancel a running session
- `/git`, `/workspaces`, `/switch` — workspace/gitrepo utilities

**Notes**
- The gateway must run on the same machine as VS Code for connected mode.
- Never commit tokens; use the keychain commands (or env vars as a fallback for local dev only).
- For safety, `/task` and `/plan` currently enforce **one active invoke session per user** (`maxActiveInvokeSessionsPerUser=1`, WU-002 contract). If you need true multi-session invoking, a safe default is `2` (update the WU-002 contract + tests accordingly).

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
- **Durable execution (no tasks):** `@executive2p5-planner` → `@executive2p5` (plan pack + progress tracker, no `.instructions/tasks/*`)
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
├── local-tracker/
├── RannIA/
```

## Documentation

- [Agents vs Skills](docs/agents-vs-skills.md)
- [Agent Architecture Simplicity](docs/agent-architecture-simplicity.md)
- [Agent Hooks](docs/agent-hooks.md)
- [Skills Governance](docs/skills-governance.md)
- [MCP Workflow](docs/mcp-workflow.md)
- [Security Model](docs/security-model.md)
- [Instruction Changelog](docs/instruction-changelog.md)

## Contributing

1. Add/update agent files in `.github/agents/`.
2. Add/update skills in `.github/skills/<skill>/SKILL.md`.
3. Keep shared operating guidance in `.github/copilot-instructions.md` concise and stable.
4. Update docs under `docs/` when behavior/workflows change.
