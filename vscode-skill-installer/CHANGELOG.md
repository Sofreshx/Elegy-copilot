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

### Planned

- Marketplace publishing
- Mobile companion PWA deployment
- Enhanced conflict resolution for offline sync
- News feed integration (optional)
