---
schema: task/v1
id: task-000397
title: "Implement session tracker for Copilot sessions"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["csharp-expert"]
depends_on: ["task-000395"]
next_tasks: ["task-000398"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Track all active Copilot chat sessions initiated through the remote-control participant or directly in VS Code. This provides visibility into what agents are doing, what tools they're calling, and allows for debugging and monitoring.

**Key requirements**:
- Central session registry tracking all active sessions
- Monitor tool calls (tool name, arguments, results)
- Capture progress messages and state transitions
- Persist session logs to .instructions-output/ for post-session debugging
- Provide queryable API for session state (used by WebSocket server, event system)

**Session lifecycle**:
1. Session created when agent invoked
2. Tool calls tracked as they occur
3. Progress messages captured
4. Session completed/failed
5. Log written to disk

## Acceptance Criteria

- [x] Session registry tracks active sessions (in-memory map)
- [x] Tool call events captured:
  - Tool name (e.g., read_file, grep_search)
  - Arguments (sanitized if sensitive)
  - Result/error
  - Timestamp
- [x] Progress messages tracked (agent thinking, executing, responding)
- [x] Session logs written to `.instructions-output/sessions/<session-id>.json`
- [x] Query API exposed:
  - `get_active_sessions()` - List all active sessions
  - `get_session_details(id)` - Get full session state
  - `get_session_log(id)` - Retrieve session log
- [x] Session metadata: start time, end time, agent name, status, result

## Plan / Approach

1. **Session model**: Define TypeScript interface for Session (id, agent, status, tool_calls[], messages[], timestamps)
2. **Registry implementation**: In-memory Map<session_id, Session>
3. **Event hooks**: Integrate with VS Code chat API to capture:
   - Session start (chat participant invoked)
   - Progress events (via progress tokens)
   - Tool calls (if exposed by API)
   - Session completion
4. **Log persistence**: On session end, write JSON to .instructions-output/sessions/
5. **Query API**: Export functions for other modules to query session state
6. **Cleanup**: Remove old sessions from memory after completion (keep logs on disk)

**Log format** (.instructions-output/sessions/session-<id>.json):
```json
{
  "session_id": "uuid",
  "agent": "@executive2-planner",
  "start_time": "2026-02-01T10:00:00Z",
  "end_time": "2026-02-01T10:05:23Z",
  "status": "completed",
  "tool_calls": [
    {
      "timestamp": "2026-02-01T10:00:15Z",
      "tool": "read_file",
      "args": { "filePath": "..." },
      "result": "..."
    }
  ],
  "messages": [
    { "timestamp": "...", "type": "progress", "content": "..." }
  ],
  "result": "..."
}
```

## Attempts / Log

**2026-02-01**: Implemented all missing pieces in sessionManager.ts:
1. **Tool call tracking**:
   - Added `ToolCall` interface with timestamp, tool, args, result, durationMs, error
   - Added `toolCalls: ToolCall[]` to `AgentSession`
   - Added `addToolCall(sessionId, toolCall)` method with sanitization
   - Emits `tool_call` event type for WebSocket broadcasting
   - Sensitive args (password, secret, token, etc.) are redacted

2. **Disk persistence**:
   - Added `writeSessionLog(sessionId)` method (async, non-blocking)
   - Called automatically on session completion/failure
   - Creates `.instructions-output/sessions/` directory if not exists
   - Writes JSON log with full session data (tool calls, messages, response)

3. **Settings added to package.json**:
   - `skillInstaller.session.loggingEnabled` (boolean, default true)
   - `skillInstaller.session.maxLogSize` (number, default 100KB)

4. **Query API**:
   - Added `getSessionLog(sessionId)` method for retrieving persisted logs

Compilation validated successfully.

## Failures

(Document any blockers or failed approaches)

## Notes / Discoveries

**VS Code API limitations**:
- May not have direct access to tool call events from chat API
- May need to intercept via extension host logging or monkey-patching
- Alternative: Parse agent responses for tool call mentions

**Performance considerations**:
- Don't keep logs in memory indefinitely
- Consider max session history (e.g., keep last 100 in memory)
- Async file writes to avoid blocking

**Privacy**:
- Be careful logging sensitive data (API keys, tokens)
- Sanitize file paths, redact credentials
- Add option to disable logging via settings

## Next Steps

Once complete:
- Proceed to task-000398 (event emission system)
- Integrate session tracker with chat participant API (task-000396)
- Test session tracking end-to-end
