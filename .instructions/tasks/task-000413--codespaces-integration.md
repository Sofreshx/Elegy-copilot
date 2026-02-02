---
schema: task/v1
id: task-000413
title: "Add Codespaces integration for cloud agent runs"
type: feature
status: done
priority: medium
owner: lolzi
skills: ["terraform"]
depends_on: ["task-000412"]
next_tasks: ["task-000414"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Spin up GitHub Codespaces with the instruction-engine extension pre-installed for cloud-based agent execution when no local VS Code instance is available. This provides a fully-featured development environment for agent sessions triggered from mobile.

Codespaces are ephemeral: created on-demand, execute the agent session, sync results back to relay, then auto-stop to minimize costs. The extension should be pre-configured via devcontainer to enable immediate agent execution.

**Related Files:**
- `.devcontainer/devcontainer.json` - Codespace configuration
- `vscode-skill-installer/` - Extension to be pre-installed
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`
- Workflow dispatch: `task-000412`

**Key Requirements:**
- Codespace creation via GitHub API
- Extension auto-installed (devcontainer config)
- Agent session started in Codespace automatically
- Results synced back to relay
- Codespace auto-stopped after completion (cost optimization)

## Acceptance Criteria

- [ ] Codespace creation via GitHub API implemented
- [ ] Extension auto-installed via devcontainer configuration
- [ ] Agent session started automatically in Codespace
- [ ] Results synced back to relay service
- [ ] Codespace auto-stopped after completion (idle timeout or explicit stop)
- [ ] Error handling for Codespace creation failures
- [ ] Cost monitoring and alerting for runaway Codespaces
- [ ] Logs from Codespace session accessible via relay
- [ ] Support for multiple concurrent Codespace sessions per user

## Plan / Approach

1. **Create devcontainer configuration**:
   - Add `.devcontainer/devcontainer.json` with extension pre-install
   - Configure Node.js environment and dependencies
   - Add startup script to wait for extension activation

2. **Implement Codespace API integration**:
   - Use GitHub REST API to create Codespace
   - Pass session parameters as environment variables
   - Handle creation failures and rate limits

3. **Agent session orchestration**:
   - Wait for extension activation (polling /health endpoint)
   - Trigger agent session via chat participant API
   - Stream progress events to relay

4. **Result sync and cleanup**:
   - Package agent output (plans, logs, artifacts)
   - POST to relay service
   - Stop Codespace via API (or set idle timeout)

5. **Testing**:
   - Manual Codespace creation and session execution
   - Integration test with workflow dispatch
   - Concurrent session handling
   - Cost monitoring (ensure auto-stop works)

## Attempts / Log

_No attempts yet_

## Failures

_None yet_

## Notes / Discoveries

**Codespace Creation Time:**
- Typical creation: 2-3 minutes (cold start)
- With prebuilds: 30-60 seconds
- Consider prebuild configuration for faster starts

**Extension Activation:**
- Extension must be activated before chat participant API is available
- Use health check endpoint or extension activation event
- Timeout after 5 minutes if extension fails to activate

**Cost Optimization:**
- Codespaces billed per core-hour (e.g., 2-core = $0.18/hr)
- Auto-stop after 30 minutes idle (configurable)
- Delete Codespace after 7 days of inactivity
- Monitor for runaway sessions (alert if > 1 hour runtime)

**GitHub API:**
- `POST /user/codespaces` - Create Codespace
- `POST /user/codespaces/{codespace_name}/stop` - Stop Codespace
- `GET /user/codespaces/{codespace_name}` - Check status
- Rate limit: 5000 requests/hour for authenticated users

**Environment Variables:**
- `SESSION_ID` - Session identifier for relay
- `AGENT_NAME` - Which agent to invoke (e.g., `@executive2-planner`)
- `PROMPT` - User's prompt/command
- `RELAY_WEBHOOK_URL` - Where to POST results

## Next Steps

1. Create devcontainer configuration with extension pre-install
2. Implement GitHub Codespaces API client
3. Add agent session orchestration logic
4. Implement result sync and auto-stop
5. Add integration tests
6. Document Codespace workflow in mobile app
