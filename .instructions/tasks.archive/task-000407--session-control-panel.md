---
schema: task/v1
id: task-000407
title: "Build session control panel"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["frontend", "react-query"]
depends_on: ["task-000396", "task-000403", "task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Build the Sessions tab in the mobile app for starting and monitoring agent sessions. Users can select a connected client, choose an agent, enter a prompt, and monitor real-time progress including tool calls and streaming output.

Uses the `/api/sessions` endpoints from the relay API (task-000396). Receives real-time updates via WebSocket events (task-000403) for session progress, tool calls, and completion.

Part of Phase 3 from `.instructions/artefacts/mobile-companion-PLAN-artefact.md`.

## Acceptance Criteria

- [x] Active sessions list with real-time status updates
- [x] Start session form with:
  - [x] Client selector (dropdown of connected clients)
  - [x] Agent selector (dropdown of available agents)
  - [x] Prompt input (textarea)
  - [x] Start button
- [x] Session progress view showing:
  - [x] Streaming agent messages
  - [x] Tool calls with parameters (expandable)
  - [x] Tool results
  - [x] Elapsed time
- [x] Cancel session button
- [x] Session history (completed/failed sessions)
- [x] Filter sessions by status (active/completed/failed)
- [x] Auto-scroll to latest message during streaming
- [x] Error handling for session failures

## Plan / Approach

1. **Data Layer**:
   - Create React Query hooks:
     - `useSessions()` - fetch all sessions
     - `useSessionDetails(sessionId)` - fetch specific session with messages
     - `useStartSession()` - mutation to start new session
     - `useCancelSession()` - mutation to cancel session
   - Set up WebSocket event listeners for:
     - `session:started`
     - `session:message` (streaming)
     - `session:tool-call`
     - `session:tool-result`
     - `session:completed`
     - `session:failed`
   - Update React Query cache on WebSocket events

2. **UI Components**:
   - `SessionList` - list of active/historical sessions
   - `SessionCard` - individual session summary
   - `StartSessionForm` - form to initiate new session
   - `SessionProgress` - detailed progress view
   - `MessageStream` - scrollable message display
   - `ToolCallItem` - expandable tool call details
   - `SessionStatus` - status badge

3. **Start Session Flow**:
   - Validate form inputs
   - Call `POST /api/sessions` with clientId, agentName, prompt
   - Navigate to progress view on success
   - Show error toast on failure

4. **Real-Time Progress**:
   - Subscribe to session-specific WebSocket events
   - Append messages as they stream in
   - Highlight tool calls with different styling
   - Auto-scroll to bottom unless user scrolled up
   - Show typing indicator during active streaming

5. **Session History**:
   - List past sessions with status, timestamp, summary
   - Tap to view full details
   - Filter by status or date range
   - Persist recent sessions in IndexedDB for offline viewing

## Attempts / Log

**2026-02-01: Implementation complete**
- Updated `relayApi.ts` with session types (`Session`, `SessionStatus`, `ToolCall`, `SessionMessage`, `Agent`) and API functions (`getSessions`, `getSessionDetails`, `startSession`, `cancelSession`, `getAgents`, `subscribeToSessionEvents`)
- Created `useSessions.ts` hooks with React Query integration:
  - `useSessions()` - fetches sessions list with WebSocket real-time updates
  - `useSessionDetails(sessionId)` - fetches session details with auto-refresh for active sessions
  - `useAgents()` - fetches available agents
  - `useStartSession()` - mutation to start new session
  - `useCancelSession()` - mutation with optimistic updates
- Created session components:
  - `SessionCard.tsx` - session summary card with status badge, agent icon, prompt preview, stats
  - `SessionList.tsx` - filterable list (all/active/history) with loading/error/empty states
  - `StartSessionModal.tsx` - modal form with client/agent selectors and prompt textarea
  - `SessionProgress.tsx` - detailed progress view with message timeline, expandable tool calls, auto-scroll, elapsed time, cancel button
- Updated `Sessions.tsx` page to integrate all components with active session highlight section and FAB button
- Build verified: `npm run build` passes successfully

## Failures

_Document any blockers or failed approaches_

## Notes / Discoveries

- Tool calls should be collapsible to avoid cluttering the view
- Consider syntax highlighting for tool parameters (JSON)
- Streaming messages need efficient rendering (use virtualization if many messages)
- Cancel action should be optimistic (show immediately, handle failure gracefully)
- Session polling fallback if WebSocket disconnects during active session
- Consider showing token/cost estimates if available from agent metadata

## Next Steps

Integrate with AI chat interface (task-000409) for more conversational interaction.
