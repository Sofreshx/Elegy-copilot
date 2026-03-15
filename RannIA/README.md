# RannIA (Instruction Engine Skill Installer)

> Workspace management for Instruction Engine: skills, agents, tasks, dump cleanup, and remote control.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![VS Code](https://img.shields.io/badge/VS%20Code-1.85%2B-blue)

## Features

### Skill Discovery
Browse and toggle available skills from the Instruction Engine. Skills provide domain-specific knowledge (e.g., `wolverine-http`, `marten-events`, `firebase-auth`) that enhance AI assistant capabilities. Asset mutation flows now hand off to the `copilot-ui` catalog control plane instead of treating direct repo-local copying as the primary authority.

### Agent Management  
View and enable/disable agents across workspace repos. Agents are specialized AI workflows defined in `.github/agents/*.agent.md`.

### Task Tracking
Track tasks from the canonical repo-state task store at `~/.copilot/repo-state/<repoId>/tasks/*.md` with full YAML front matter support:
- Filter by owner, status, priority
- Task Workflow view with "Next Up" and "Active" lanes
- Archive done tasks and purge archived tasks from the workflow view

Repo-local `.instructions/tasks/` is legacy migration input only. It is no longer the default discovery surface.

### Operations
Operational visibility for remote control components:
- WebSocket server status + connected clients (optional; not required for Discord ACP mode)
- Messaging gateway status (Discord ready state, active sessions)
- Copilot permission request queue (pending and recent decisions)

### Dump Cleaner
Safe cleanup utility for workspace dump files (e.g., `tmpclaude-*`):
- Scans workspace roots shallowly for matching glob patterns
- Trash-only deletion with modal confirmation
- Refuses symlinks and paths outside workspace roots

### Remote Control
The `@remote-control` chat participant enables programmatic agent invocation:
- `/status` - Show active and recent sessions
- `/cancel` - Cancel a running session by ID
- `/list` - List available agents in the workspace
- `/invoke` - Invoke an agent with a prompt

## Installation

### From VSIX (Recommended)
1. Download the latest `.vsix` from [Releases](https://github.com/Sofreshx/instruction-engine/releases)
2. In VS Code: **Extensions: Install from VSIX...**
3. Select the downloaded file
4. Reload window

### From Source
```bash
cd RannIA
npm install
npm run compile
```
Then use **Developer: Install Extension from Location...** and select the folder.

## Views

| View | Description |
|------|-------------|
| **Skill Discovery** | Available skills from instruction-engine |
| **Agents** | Agents across workspace repos |
| **Task Workflow** | Queue and prioritize tasks |
| **Audit Results** | Code quality audit results |
| **Connections** | WebSocket server (optional) and messaging gateway status |
| **Requests** | Active and recent agent sessions |
| **Permissions** | Copilot permission requests and decisions |
| **Dump Cleaner** | Workspace dump file scanner and safe cleanup |
| **MCP** | MCP server management |

## Commands

| Command | Description |
|---------|-------------|
| Refresh Views | Reload all views |
| Open E2E Dashboard | Launch configured E2E URL |
| Run Audit | Execute code quality audit |
| Enable/Disable Skill | Toggle skill availability |
| Enable/Disable Agent | Toggle agent availability |
| Initialize Skills | Open the `copilot-ui` catalog control plane handoff for asset mutation flows |
| Clear Repo Context | Reset context for a repo |
| Migrate Legacy .instructions State | Import legacy repo-local state into the canonical `~/.copilot/repo-state/<repoId>/` store |
| Archive Done Tasks | Move completed tasks to `~/.copilot/repo-state/<repoId>/tasks.archive` |
| Purge Archived Tasks | Delete archived task files |

## Configuration

### Basic Settings
- `skillInstaller.tasks.owner` - Your dev handle for task filtering
- `skillInstaller.tasks.onlyOwner` - Show only your tasks
- `skillInstaller.workflow.nextUpLimit` - Max items in "Next Up" lane
- `skillInstaller.catalog.baseUrl` - Base URL for the `copilot-ui` catalog control plane handoff

### WebSocket Server
- `skillInstaller.ws.enabled` - Enable WebSocket server
- `skillInstaller.ws.port` - Server port (0 = random)
- `skillInstaller.ws.heartbeatInterval` - Ping interval in ms

### Session Logging
- `skillInstaller.session.loggingEnabled` - Enable session logs
- `skillInstaller.session.maxLogSize` - Max log entry size

See [full settings documentation](https://github.com/Sofreshx/instruction-engine#settings) for all options.

## Development

```bash
# Watch mode
npm run watch

# Debug
# Press F5 to launch Extension Development Host

# Package
npm run package
```

## Screenshots

<!-- TODO: Add screenshots
![Skill Discovery](resources/screenshots/skills.png)
![Task Workflow](resources/screenshots/workflow.png)
![Remote Control](resources/screenshots/remote.png)
-->

## License

See [LICENSE.txt](LICENSE.txt)

---

**[Instruction Engine](https://github.com/Sofreshx/instruction-engine)** — Enhance your AI-assisted development workflow
