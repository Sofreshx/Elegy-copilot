---
schema: task/v1
id: task-000406
title: "Build client management view"
type: feature
status: done
priority: high
owner: "lolzi"
skills: ["frontend", "react-query"]
depends_on: ["task-000399", "task-000403", "task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Build the Dashboard tab in the mobile app that shows all connected VS Code instances (clients). Displays real-time connection status, quick actions (disconnect, view sessions), and client details.

Uses the `/api/clients` and `/api/clients/:clientId/sessions` endpoints from the relay API (task-000399). Receives real-time updates via WebSocket events (task-000403).

Part of Phase 3 from `.instructions/artefacts/mobile-companion-PLAN-artefact.md`.

## Acceptance Criteria

- [x] Client list view showing all connected VS Code instances
- [x] Connection status indicator (online/offline) with timestamp
- [x] Client details expandable/collapsible (workspace path, VS Code version, last seen)
- [x] Disconnect button for each client
- [x] Real-time updates when clients connect/disconnect (via WebSocket)
- [x] Empty state when no clients connected
- [x] Pull-to-refresh to manually fetch latest state
- [x] Error handling for API failures
- [x] Loading states while fetching

## Plan / Approach

1. **Data Layer**:
   - Create React Query hooks:
     - `useClients()` - fetch all clients
     - `useClientSessions(clientId)` - fetch sessions for a client
     - `useDisconnectClient()` - mutation for disconnect action
   - Set up WebSocket event listeners for:
     - `client:connected`
     - `client:disconnected`
     - `client:updated`
   - Invalidate React Query cache on WebSocket events

2. **UI Components**:
   - `ClientList` - main container component
   - `ClientCard` - individual client display with expandable details
   - `ClientStatus` - status indicator badge
   - `ClientActions` - action buttons (disconnect, view sessions)
   - `EmptyState` - message when no clients connected

3. **State Management**:
   - Use React Query for server state
   - Local state for expanded/collapsed cards
   - Optimistic updates for disconnect action

4. **Real-Time Updates**:
   - Subscribe to WebSocket events in `useEffect`
   - Update React Query cache when events received
   - Show toast notifications for connect/disconnect events

5. **Interactions**:
   - Tap card to expand/collapse details
   - Swipe actions for quick disconnect (optional)
   - Long-press for additional options
   - Navigate to session list on "View Sessions" tap

## Attempts / Log

**2026-02-01**: Implementation complete.

Files created:
- `src/services/relayApi.ts` - API layer for relay WebSocket communication (getClients, disconnectClient, subscribeToClientEvents)
- `src/hooks/useClients.ts` - React Query hooks (useClients, useDisconnectClient) with real-time WebSocket event subscriptions
- `src/components/clients/ClientCard.tsx` + CSS - Expandable client card with status indicator, details, and disconnect action
- `src/components/clients/ClientList.tsx` + CSS - Main list container with loading/error/empty states

Files updated:
- `src/pages/Dashboard.tsx` - Full implementation with useClients hook, ClientList, pull-to-refresh, relay status display
- `src/pages/Dashboard.css` - Added styles for pull-to-refresh and connection hint

Features implemented:
- [x] Client list view showing all connected VS Code instances
- [x] Connection status indicator (online/offline) with timestamp
- [x] Client details expandable/collapsible (workspace path, VS Code version, last seen)
- [x] Disconnect button with confirmation dialog
- [x] Real-time updates when clients connect/disconnect (via WebSocket subscription)
- [x] Empty state with setup instructions
- [x] Pull-to-refresh for manual refresh
- [x] Error handling with retry button
- [x] Loading states while fetching

Build verification: `npm run build` passed successfully.

## Failures

_Document any blockers or failed approaches_

## Notes / Discoveries

- Client status should show "last seen" timestamp when offline
- Consider color coding: green (online), gray (offline), yellow (connecting)
- Disconnect action should prompt for confirmation
- WebSocket events should be throttled/debounced if many clients reconnecting
- Consider pagination if many clients (e.g., >100)

## Next Steps

Integrate with session control panel (task-000407) for viewing client sessions.
