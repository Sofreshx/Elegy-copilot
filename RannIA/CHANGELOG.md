# Changelog

All notable changes to the Instruction Engine Skill Installer extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-02-02

### Added

- **Skill Discovery View**: Browse and toggle available skills from instruction-engine
- **Agents View**: See and enable/disable agents across workspace repos
- **Tasks View**: Track tasks from `.instructions/tasks/*.md` with YAML front matter support
- **Task Workflow View**: Queue and prioritize tasks with "Next Up" lane
- **Active Tasks View**: See currently in-progress tasks
- **Audit View**: Run and view audit results for code quality
- **Remote Control Chat Participant**: `@remote-control` for programmatic agent invocation
  - `/status` - Show active and recent sessions
  - `/cancel` - Cancel a running session
  - `/list` - List available agents
  - `/invoke` - Invoke an agent with a prompt
- **WebSocket Server**: Real-time communication for mobile companion app
- **GitHub OAuth**: Login flow for authenticated mobile companion access
- **Session Logging**: Detailed logs to `.instructions-output/sessions/`
- Enablement state persisted to workspace settings and repo registry

### Configuration

- `skillInstaller.registry.fileName` - Path for enablement metadata
- `skillInstaller.skills.disabledByRepo` - Disabled skills per repo
- `skillInstaller.agents.disabledByRepo` - Disabled agents per repo
- `skillInstaller.e2e.url` - E2E dashboard URL
- `skillInstaller.workflow.nextUpLimit` - Task workflow lane limit
- `skillInstaller.tasks.onlyOwner` - Filter tasks by owner
- `skillInstaller.tasks.owner` - Your dev handle
- `skillInstaller.ws.*` - WebSocket server settings
- `skillInstaller.session.*` - Session logging settings
- `skillInstaller.oauth.*` - GitHub OAuth settings

### Commands

- Refresh Skills, Tasks & Agents
- Open E2E Dashboard
- Run Audit / Refresh Audit Results
- Enable/Disable Skill
- Enable/Disable Agent
- Clear Repo Context / Clear All Repo Contexts
- Show Connected Clients
- Login/Logout with GitHub

## [Unreleased]

### Changed — RannIA Rebrand
- Extension display name changed to **RannIA**. Internal identifiers (`publisher`, `name`, `extensionId`) remain stable for marketplace continuity.
- Output channel renamed to "RannIA".
- Container title and config section titles updated to "RannIA".

### Removed — Remote Stack Cleanup
- **Cloud Relay** (`cloud-relay/`): entire directory, CI workflows (`remote-agent.yml`), and all relay client code removed.
- **Mobile Companion** (`mobile-companion/`): entire directory, CI workflows, and all related docs removed.
- Relay client (`relayClient.ts`, `relayAuthBridge.ts`), OAuth manager, and all relay/mobile UI wiring removed from the extension.
- GitHub OAuth settings (`skillInstaller.oauth.*`) removed from extension manifest.

### Changed — Single Activity Bar Tab
- Consolidated all views into a single Activity Bar container (`skillInstaller`). The `skillInstallerOps` container has been removed.
- Operations views (Connections, Requests, Permissions, MCP) now appear under the main tab alongside Skills, Agents, Workflow, and Audit.

### Added — Dump Cleaner UI
- New **Dump Cleaner** view in the Activity Bar tab. Scans workspace roots for files matching configurable glob patterns (default: `tmpclaude-*`).
- Safe delete: trash-only deletion with modal confirmation. Refuses symlinks and paths outside workspace roots.
- Configurable via `skillInstaller.dumpCleaner.patterns` setting.

### Added — Discord Messaging Gateway Integration
- **Status file reader**: Connections view now shows Discord gateway status (ready state, active sessions) read from `~/.instruction-engine/messaging-gateway.status.json`.
- **Status file writer**: `local-tracker` gateway emits an atomic heartbeat status file with schema version, config summary, secrets presence, and runtime state.
- **Optional permissions channel**: `discord.permissionsChannelId` config field — routes permission prompts to a dedicated Discord channel instead of the session thread.

### Added — Security Hardening
- 22 negative/hardening tests covering: allowlist enforcement (user IDs, guild/channel scope), workspace boundary enforcement, cross-tier rate limiting, replayed approval rejection, malformed payload handling, and invoke concurrency limiting.

### Planned

- Marketplace publishing
