---
schema: task/v1
id: task-000410
title: "Implement permission request handler"
type: feature
status: done
priority: high
owner: lolzi
skills: ["frontend", "react-query"]
depends_on: ["task-000398", "task-000405"]
next_tasks: []
created: "2026-02-01"
updated: "2026-02-01"
---

## Context

Handle `permission_requested` events from agents running on VS Code extension. When an agent needs user approval for sensitive operations (file edits, terminal commands, deletions), the mobile app should:
- Display approval dialog/modal with operation details
- Allow user to approve, deny, or defer (with timeout handling)
- Support push notifications for permission requests (when app backgrounded)
- Send approval response back to extension via relay

This is a critical security feature enabling remote agent control without sacrificing safety.

**Technical Context**:
- Depends on `task-000398` (event emission system in extension)
- Integrates with `task-000405` app shell (modal/notification layer)
- Uses relay WebSocket for bidirectional communication
- Should implement timeout (e.g., auto-deny after 2 minutes)

**Related Files**:
- `mobile-companion/src/components/PermissionModal/` (to be created)
- `vscode-skill-installer/src/session/` (event emission, see task-000398)
- Plan artefact: `.instructions/artefacts/mobile-companion-PLAN-artefact.md` (security section)

## Acceptance Criteria

- [x] Permission modal/dialog with clear operation details (file path, command, agent name)
- [x] Operation details shown (what will be changed, why, by which agent)
- [x] Approve/Deny buttons with distinct actions
- [x] Push notification API integration for backgrounded app
- [x] Timeout handling (auto-deny after 2 minutes if no response)
- [x] Response sent back to extension via relay
- [x] Loading states while awaiting extension acknowledgment
- [x] Queue multiple requests with batch approve/deny
- [x] Visual countdown timer for timeout

## Plan / Approach

1. Create permission types (permissions.ts)
2. Create usePermissions hook for state management
3. Build PermissionModal component with countdown
4. Integrate into App.tsx for global display
5. Add push notification support

## Attempts / Log

**2024-02-01**: Completed implementation:
- Created `types/permissions.ts` - Types and constants for permission requests
- Created `hooks/usePermissions.ts` - Permission state management hook with:
  - Pending/history tracking
  - Auto-expiry timeouts (2 minutes)
  - Approve/deny/approveAll/denyAll actions
  - Push notification support (Notification API)
  - Relay message handling
- Created `components/permissions/PermissionModal.tsx/css` - Modal with:
  - Operation type icon and severity badge
  - Agent name, description, file path, command display
  - Countdown timer with urgency styling
  - Approve/Deny buttons
  - Batch actions for multiple requests
- Updated `App.tsx` to show PermissionModal globally when requests pending

Build verified.

## Failures

_None_

## Notes / Discoveries

- Used Notification API for push notifications (Service Worker not required for basic notifications)
- 2-minute timeout matches VS Code's typical interaction patterns
- Multiple pending requests show batch actions for quick approval
- Severity levels (low/medium/high) help users quickly assess risk
- Countdown timer adds urgency without being intrusive
