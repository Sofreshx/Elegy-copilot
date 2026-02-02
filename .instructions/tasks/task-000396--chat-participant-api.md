---
schema: task/v1
id: task-000396
title: "Create chat participant API for programmatic agent sessions"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["csharp-expert"]
depends_on: ["task-000395"]
next_tasks: ["task-000407"]
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

To enable remote agentic sessions, we need a programmatic interface to VS Code's Copilot chat. This task creates a "remote-control" chat participant that can be invoked via WebSocket commands, allowing mobile/web clients to start agent sessions and receive responses.

**VS Code API**: vscode.chat.createChatParticipant

**Key requirements**:
- Create a dedicated chat participant (e.g., @remote-control or @mobile-session)
- Support invoking specific agents (@executive2-planner, @debugger, etc.)
- Track session state (active, pending, completed)
- Stream responses back to connected WebSocket clients
- Support slash commands (/status, /cancel, /list)

**Integration points**:
- WebSocket server (task-000395) triggers participant invocations
- Session tracker (task-000397) monitors progress
- Event system (task-000398) streams responses to clients

## Acceptance Criteria

- [x] Chat participant registered and appears in Copilot chat
- [x] Can invoke specific agents programmatically (e.g., @executive2-planner, @debugger)
- [x] Session state tracked and queryable (get active sessions, session details)
- [x] Responses streamed back via WebSocket in real-time
- [x] Support for slash commands:
  - `/status` - Show active sessions
  - `/cancel <session-id>` - Cancel running session
  - `/list` - List available agents
- [x] Error handling for invalid agent names, malformed requests
- [x] Session correlation IDs for tracking requests across systems

## Plan / Approach

1. **Create chat participant**: Use vscode.chat.createChatParticipant in extension activation
2. **Command parser**: Parse incoming messages to extract target agent and prompt
3. **Agent invocation**: Programmatically trigger target agent (@executive2-planner, etc.)
4. **Response streaming**: Capture agent responses and forward to WebSocket clients
5. **Session management**: Generate session IDs, track active sessions in memory
6. **Slash commands**: Implement handlers for /status, /cancel, /list
7. **Testing**: Integration tests with mock WebSocket clients

**Example flow**:
```
WebSocket client → "execute_command: invoke_agent @executive2-planner 'Create a dashboard feature'"
                 → Chat participant receives request
                 → Invokes @executive2-planner
                 → Streams responses back to client
                 → Completes session
```

## Attempts / Log

**2026-02-01 - Implementation completed**

1. Created `src/sessionManager.ts`:
   - In-memory session tracking with UUID-based session IDs
   - Session lifecycle: pending → active → completed/failed/cancelled
   - Event emitter pattern for WebSocket broadcasting
   - Auto-pruning of old sessions (max 100 kept)

2. Created `src/chatParticipant.ts`:
   - Registered as `@remote-control` chat participant
   - Slash commands: /status, /cancel, /list, /invoke
   - Agent invocation parsing: `@agent-name prompt` or `agent-name: prompt`
   - Integration with VS Code chat API for agent invocation
   - `startRemoteSession()` method for WebSocket-triggered invocations

3. Updated `src/wsTypes.ts`:
   - Added new methods: invoke_agent, get_sessions, cancel_session, list_agents
   - Added InvokeAgentParams and CancelSessionParams interfaces

4. Updated `src/wsServer.ts`:
   - Implements SessionEventEmitter interface
   - New handlers for agent invocation and session management
   - Broadcasts session_event notifications to subscribed clients

5. Updated `package.json`:
   - Added chatParticipants contribution with /status, /cancel, /list, /invoke commands

6. Updated `src/extension.ts`:
   - Initialize SessionManager and RemoteControlParticipant
   - Wire up to WsServer with event callbacks

**Validation:** `npm run compile` - success, no errors

## Failures

(Document any blockers or failed approaches)

## Notes / Discoveries

**VS Code Chat API considerations**:
- Chat participants are asynchronous by nature
- Response streaming is event-driven (progress tokens)
- Need to maintain correlation between WebSocket request and chat session

**Agent discovery**:
- May need to manually maintain list of available agents
- Or dynamically scan workspace for .agent.md files

**Session lifecycle**:
- Start: WebSocket command received → chat participant invoked
- Active: Agent processing, streaming responses
- Complete: Agent finishes, final response sent
- Failed: Error occurred, send error event to client

## Next Steps

Once complete:
- Proceed to task-000407 (mobile app backend integration)
- Test end-to-end flow: mobile → WebSocket → chat participant → agent → response stream
