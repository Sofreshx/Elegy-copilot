---
schema: task/v1
id: task-000412
title: "Create workflow dispatch endpoint for remote triggers"
type: feature
status: done
priority: medium
owner: lolzi
skills: ["terraform"]
depends_on: ["task-000400"]
next_tasks: ["task-000413"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

GitHub Actions workflow for remote agent triggers. This enables the mobile companion app to trigger agent sessions in cloud environments (GitHub Actions or Codespaces) when no local VS Code instance is available.

The workflow uses `workflow_dispatch` as the trigger type with structured inputs for command routing. It should be callable from the mobile app through the cloud relay service, providing a fallback execution environment for agent sessions.

**Related Files:**
- `.github/workflows/` - Workflow definitions
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`
- Relay protocol design: `task-000400`

**Key Requirements:**
- Workflow receives command, agent name, prompt, and session ID
- Triggers appropriate cloud environment (Codespace preferred, runner as fallback)
- Reports status back via webhook to relay service
- Supports authentication and authorization checks

## Acceptance Criteria

- [ ] Workflow file `.github/workflows/remote-agent.yml` created
- [ ] Inputs defined: `command`, `agent_name`, `prompt`, `session_id`
- [ ] Workflow triggers Codespace or cloud environment appropriately
- [ ] Status reported back via webhook to relay service
- [ ] Authentication verified (GitHub token, user permissions)
- [ ] Error handling for failed dispatches
- [ ] Logs accessible from mobile app via relay
- [ ] Rate limiting implemented (max N dispatches per user per hour)

## Plan / Approach

1. **Create workflow file** (`.github/workflows/remote-agent.yml`):
   - Define `workflow_dispatch` trigger with inputs
   - Add authentication/authorization step
   - Route to appropriate execution environment

2. **Implement input validation**:
   - Allowlist for agent names (no arbitrary code)
   - Sanitize prompt input
   - Validate session ID format

3. **Add status reporting**:
   - POST status to relay webhook endpoint
   - Include: workflow_run_id, status, logs_url
   - Handle network failures (retry logic)

4. **Testing**:
   - Manual trigger via GitHub UI
   - Trigger from relay service (integration test)
   - Test failure scenarios (invalid inputs, network issues)

## Attempts / Log

_No attempts yet_

## Failures

_None yet_

## Notes / Discoveries

**Security Considerations:**
- Workflow secrets must be scoped appropriately (not exposed in logs)
- Command allowlist prevents arbitrary code execution
- User GitHub token validated before dispatch
- Rate limiting prevents abuse

**GitHub Actions Limits:**
- Free tier: 2000 minutes/month
- Concurrent job limit may throttle dispatches
- Consider cost monitoring for heavy users

**Status Webhook Design:**
- Endpoint: `POST /api/workflow-status`
- Payload: `{ workflow_run_id, session_id, status, logs_url, timestamp }`
- Relay forwards to connected mobile clients

## Next Steps

1. Create workflow YAML file with workflow_dispatch trigger
2. Define input schema and validation rules
3. Implement webhook status reporting
4. Add integration tests with relay service
5. Document usage in mobile app
