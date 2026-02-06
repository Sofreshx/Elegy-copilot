---
schema: task/v1
id: task-000415
title: "Add webhook receiver for workflow notifications"
type: feature
status: done
priority: medium
owner: lolzi
skills: ["terraform", "signalr"]
depends_on: ["task-000401"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Receive GitHub webhook events for workflow completion and push notifications to the relay service and mobile app. This enables real-time status updates when cloud-based agent sessions complete, fail, or encounter issues.

The webhook receiver should be an endpoint in the relay service (or a separate serverless function) that validates GitHub webhook signatures, processes `workflow_run` events, and forwards status updates to connected mobile clients via the relay's SignalR/WebSocket connection.

**Related Files:**
- Relay service: `task-000401`
- Workflow dispatch: `task-000412`
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md`

**Key Requirements:**
- Webhook endpoint deployed and configured in GitHub repo settings
- `workflow_run` events processed (completed, failed, in_progress)
- Status pushed to relay service
- Mobile receives completion notification via push/WebSocket
- HMAC signature verification for security

## Acceptance Criteria

- [ ] Webhook endpoint deployed (relay service or serverless function)
- [ ] `workflow_run` events processed (completed, failed, in_progress, cancelled)
- [ ] Status pushed to relay service with session context
- [ ] Mobile receives completion notification in real-time
- [ ] HMAC signature verification implemented (GitHub webhook secret)
- [ ] Error handling for malformed payloads
- [ ] Retry logic for relay delivery failures
- [ ] Logs for debugging webhook delivery issues
- [ ] Rate limiting to prevent webhook spam attacks
- [ ] Support for multiple event types (workflow_run, workflow_dispatch)

## Plan / Approach

1. **Create webhook endpoint**:
   - Route: `POST /api/webhooks/github`
   - Hosted in relay service or separate Azure Function
   - Accept JSON payload from GitHub

2. **Implement HMAC signature verification**:
   - Extract `X-Hub-Signature-256` header
   - Compare with computed HMAC(secret, payload)
   - Reject if signatures don't match

3. **Parse workflow_run events**:
   - Extract: `workflow_run.id`, `status`, `conclusion`, `html_url`, `logs_url`
   - Map to session ID (from workflow inputs or env vars)
   - Handle missing/malformed data gracefully

4. **Push to relay**:
   - POST to relay's internal API: `/internal/workflow-status`
   - Payload: `{ session_id, workflow_run_id, status, conclusion, logs_url, timestamp }`
   - Relay forwards to connected mobile clients via SignalR

5. **Mobile notification**:
   - Display toast/banner: "Agent session {agent_name} completed"
   - Update session status in UI (in-progress → completed/failed)
   - Link to view logs or results

6. **Testing**:
   - Mock GitHub webhook payloads (curl or Postman)
   - Test signature verification (valid/invalid)
   - Test relay forwarding to mobile
   - Test error cases (invalid JSON, missing fields)
   - Load testing (many webhooks in short time)

## Attempts / Log

_No attempts yet_

## Failures

_None yet_

## Notes / Discoveries

**GitHub Webhook Events:**
- `workflow_run` - Workflow triggered, started, completed
  - Action: `requested`, `in_progress`, `completed`
  - Conclusion: `success`, `failure`, `cancelled`, `timed_out`
- `workflow_dispatch` - Workflow manually triggered (may not be needed if workflow_run covers this)

**Webhook Payload Structure:**
```json
{
  "action": "completed",
  "workflow_run": {
    "id": 123456789,
    "name": "Remote Agent",
    "status": "completed",
    "conclusion": "success",
    "html_url": "https://github.com/user/repo/actions/runs/123456789",
    "logs_url": "https://api.github.com/repos/user/repo/actions/runs/123456789/logs"
  },
  "repository": { ... },
  "sender": { ... }
}
```

**HMAC Signature Verification:**
- Header: `X-Hub-Signature-256: sha256={signature}`
- Algorithm: HMAC-SHA256
- Secret: Stored in relay service env vars (configured in GitHub repo webhook settings)
- Example (Node.js):
  ```js
  const crypto = require('crypto');
  const signature = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  if (signature !== req.headers['x-hub-signature-256']) throw new Error('Invalid signature');
  ```

**Session ID Mapping:**
- Workflow inputs include `session_id` (set during workflow dispatch)
- Extract from `workflow_run.inputs.session_id` or environment variable
- If missing, log error and skip relay push (can't map to mobile session)

**Relay Forwarding:**
- Relay service has internal API: `POST /internal/workflow-status`
- Authenticated with shared secret (not exposed to mobile)
- Relay looks up active SignalR connections for session owner
- Pushes event: `{ type: 'workflow_status', payload: {...} }`

**Error Handling:**
- 401 Unauthorized: Invalid HMAC signature (reject immediately)
- 400 Bad Request: Malformed JSON or missing required fields (log + return 400)
- 500 Internal Server Error: Relay unavailable (retry with exponential backoff, max 3 retries)
- 429 Too Many Requests: Rate limit exceeded (log + return 429)

**Rate Limiting:**
- Max 100 webhook events per minute per repository
- If exceeded, queue events and process in batches
- Protects against webhook spam or misconfiguration

**Deployment Options:**
1. **Relay service endpoint**: Simpler, single codebase, shared secrets already available
2. **Azure Function**: Separate serverless function, scales independently, pay-per-invocation
3. **Cloudflare Worker**: Global edge deployment, low latency, free tier generous

Recommend: **Relay service endpoint** for v1 (simpler), migrate to serverless if scaling issues arise.

**GitHub Webhook Configuration:**
- Repo settings → Webhooks → Add webhook
- Payload URL: `https://relay.example.com/api/webhooks/github`
- Content type: `application/json`
- Secret: Generate strong random secret (store in relay env vars)
- Events: Select `workflow_run` only (or "Let me select individual events")
- Active: ✓

## Next Steps

1. Create webhook endpoint in relay service (or Azure Function)
2. Implement HMAC signature verification
3. Parse workflow_run events and extract session context
4. Implement relay forwarding logic
5. Add mobile notification UI updates
6. Configure webhook in GitHub repo settings
7. Test end-to-end (dispatch workflow → webhook → relay → mobile)
8. Add monitoring and alerting for webhook failures
