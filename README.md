# 🤖 Instruction Engine

> Structured Copilot agent orchestration for multi-repo development.

[![Copilot Compatible](https://img.shields.io/badge/Copilot-Compatible-blue?logo=github)](https://docs.github.com/en/copilot)

Instruction Engine provides shared agents, skills, templates, and workflow conventions that can be reused across repositories. It is designed to keep planning, execution, testing, and task memory consistent when working with GitHub Copilot Chat.

## What lives here

### Core engine assets

- `engine-assets/agents/` — custom agents (orchestrator, testing, security, infra, review)
- `engine-assets/skills/` — domain skills (`SKILL.md` per skill)
- `engine-assets/prompts/` — VS Code prompt files (`*.prompt.md`)
- `.github/templates/` — task/progress and hook templates
- `.github/copilot-instructions.md` — shared operating rules used across repos

### Runtime/tooling components

- `RannIA/` — VS Code extension (Instruction Engine host)
- `local-tracker/` — local daemon for session/task tracking

## Discord remote control (Messaging Gateway)

Run Copilot agent sessions from Discord and stream session updates back into a Discord thread.

**How it works (local-only):**
- Discord → `local-tracker` Messaging Gateway
- Messaging Gateway → Copilot CLI ACP server (`copilot --acp --port <PORT>`)
- Gateway streams session progress + permission prompts back into Discord threads

### Prerequisites
- Node.js (for `local-tracker`)
- Copilot CLI installed and authenticated
- A Discord bot token + a server (guild) where the bot is installed
- Discord IDs (numeric): guild ID, channel ID, allowlisted user IDs

### Setup (recommended path)

0) **Create a Discord bot + gather IDs**
- Create a Discord application + bot in the Discord Developer Portal
- Install the bot into your guild (server)
- Enable Discord **Developer Mode** and copy the numeric IDs you’ll need:
  - Guild ID, Channel ID, your User ID

1) **Create the gateway config (non-secret)**
- Create/update: `~/.instruction-engine/messaging-gateway.config.json`
- Use `local-tracker/docs/messaging-gateway.config.example.json` as a template
- Ensure it contains:
  - `acp.port` (must match the `copilot --acp --port <PORT>` you start)
  - `discord.allowlistedUserIds` (your Discord user ID(s))
  - `discord.guildId`, `discord.channelId`
  - Optional: `discord.permissionsChannelId` (permission prompts in a separate channel)
  - `workspaces.allowedRoots` (absolute paths), `workspaces.activeRoot`

2) **Store secrets in OS credential store**
- Store the Discord bot token:
  - `npm --prefix local-tracker run dev:gateway -- --store-discord-bot-token`

3) **Start Copilot CLI in ACP mode (connected mode)**
```bash
copilot --acp --port 3000
```

4) **Start the Messaging Gateway**
```bash
cd local-tracker
npm install
npm run build
npm run start:gateway -- --mode connected
```

For a deeper reference (config fields, auth model, troubleshooting), see `local-tracker/docs/messaging-gateway.md`.

### Using it from Discord
- `/status` — gateway status
- `/sessions` — list recent sessions (connected mode)
- `/task prompt:<text>` — run work via `@orchestrator` (creates a thread + streams updates)
- `/plan prompt:<text>` — plan-only via `@orchestrator`
- `/stop sessionid:<id>` — cancel a running session
- `/git`, `/workspaces`, `/switch` — workspace/gitrepo utilities

**Notes**
- Connected mode requires a local ACP server (Copilot CLI `--acp`).
- Never commit tokens; use the keychain commands (or env vars as a fallback for local dev only).
- For safety, `/task` and `/plan` currently enforce **one active invoke session per user** (`maxActiveInvokeSessionsPerUser=1`, WU-002 contract). If you need true multi-session invoking, a safe default is `2` (update the WU-002 contract + tests accordingly).

## Quick start

### 0) Install globally (recommended)

Installs:
- **Copilot CLI assets** into `~/.copilot` (CLI-only)
- **VS Code Copilot Chat assets** into the **VS Code user asset home** (default: `~/Documents/instruction-engine` on Windows/macOS; `~/.local/state/instruction-engine` on Linux)

Then patches VS Code settings (`chat.*Locations`) so agents/skills/prompts/instructions are discoverable from **any repo**, without adding this repo to your workspace.

Windows (PowerShell):
```powershell
pwsh -File scripts/cli-install.ps1 --all --force
```

macOS/Linux (bash):
```bash
./scripts/cli-install.sh --all --force
```

Verify in VS Code:
- Chat view → right-click → **Diagnostics** (shows loaded agents/skills/prompts and their locations)

Verify in Copilot CLI:
- Start `copilot` and run `/agents`, `/skills`

### 1) Add the engine to your workspace

Not required for day-to-day usage.

If you want to **contribute** to agents/skills/prompts, add it as a submodule (or open this repo directly) and edit `engine-assets/*`.

### 2) Enable subagent delegation in VS Code

```json
{
  "chat.customAgentInSubagent.enabled": true
}
```

### 3) Initialize project-local memory/task structure

In Copilot Chat, run:

```text
Legacy note: repo-local .instructions/.instructions-output are being phased out.

VS Code (RannIA) now stores sessions + repo-state (tasks/enablement/audits) in a central folder
outside your repos (default: ~/Documents/instruction-engine).
```

Central VS Code state (default):

- `~/Documents/instruction-engine/session-state/<id>/...`
- `~/Documents/instruction-engine/repo-state/<repoId>/...`
- `~/Documents/instruction-engine/sessions-archive/...`

VS Code user assets (default):

- `~/Documents/instruction-engine/agents/*.agent.md`
- `~/Documents/instruction-engine/skills/<skill>/SKILL.md`
- `~/Documents/instruction-engine/prompts/*.prompt.md`
- `~/Documents/instruction-engine/copilot-instructions.md`

### 4) Recommended `.gitignore` (legacy)

```gitignore
# Legacy repo-local state (deprecated)
.instructions/
.instructions-output/
```

## Execution patterns

- **Unified execution:** `@orchestrator` (plan → implement → verify)
- **Validation/testing:** `@unit-test-runner`, `@integration-test-runner`, `@e2e-browser`
- **Quality/security:** `@code-reviewer`, `@security-auditor`, `@security-scanner`, `@security-fixer`

## Current inventory (repo snapshot)

Canonical assets live under `engine-assets/*`.

To re-check counts locally:

```bash
find engine-assets/agents -maxdepth 1 -name '*.agent.md' | wc -l
find engine-assets/skills -mindepth 1 -maxdepth 1 -type d | wc -l
```

## Repository layout

```text
instruction-engine/
├── .github/
│   ├── templates/
│   └── copilot-instructions.md
├── engine-assets/
│   ├── agents/
│   ├── skills/
│   └── prompts/
├── .instructions/           # this repo's own task/context memory
├── .instructions-output/    # legacy generated artifacts/logs (deprecated)
├── docs/
├── local-tracker/
├── RannIA/
```

## Documentation

- [Copilot CLI Adoption Playbook](docs/copilot-cli-playbook.md)
- [Agents vs Skills](docs/agents-vs-skills.md)
- [Agent Architecture Simplicity](docs/agent-architecture-simplicity.md)
- [Agent Hooks](docs/agent-hooks.md)
- [Skills Governance](docs/skills-governance.md)
- [MCP Workflow](docs/mcp-workflow.md)
- [Security Model](docs/security-model.md)
- [Instruction Changelog](docs/instruction-changelog.md)

## Contributing

1. Add/update agent files in `engine-assets/agents/`.
2. Add/update skills in `engine-assets/skills/<skill>/SKILL.md`.
3. Keep shared operating guidance in `.github/copilot-instructions.md` concise and stable.
4. Update docs under `docs/` when behavior/workflows change.
