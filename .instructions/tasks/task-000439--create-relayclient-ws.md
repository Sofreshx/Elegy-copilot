---
schema: task/v1
id: task-000439
title: "Create RelayClient outbound WebSocket client"
type: feature
status: done
priority: critical
owner: ""
skills: []
group_id: "group-02-ext-relay"
group_title: "Group 2: Extension Relay Client"
group_order: 2
depends_on: ["task-000438"]
next_tasks: ["task-000440"]
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

Create the core outbound WebSocket client that connects the VS Code extension to the cloud relay, enabling message routing between mobile and extension.

**Key files to read before starting:**
- `vscode-skill-installer/src/wsServer.ts` — existing WS handler patterns and `routeRequest` method
- `vscode-skill-installer/src/wsTypes.ts` — WsRequest/WsResponse types
- `vscode-skill-installer/src/clientRegistry.ts` — client tracking patterns
- `cloud-relay/src/types.ts` — `RelayEnvelope` type
- `.instructions/artefacts/relay-protocol.md` Sections 2 (envelope), 3.4 (WS auth)
- `vscode-skill-installer/src/relayAuthBridge.ts` (created in task-000438)

## Acceptance Criteria

- [ ] `relayClient.ts` exists with full connection, reconnection, and message bridging
- [ ] Handles relay envelopes (unwrap payload, route to handler, wrap response)
- [ ] Reconnects with exponential backoff + jitter
- [ ] Token refresh on auth failure via RelayAuthBridge
- [ ] Fires status change events
- [ ] No TypeScript errors

## Plan / Approach

1. **Create `vscode-skill-installer/src/relayClient.ts`**:
   - `RelayClientConfig` interface: `relayUrl`, `reconnectMaxRetries` (10), `reconnectBaseDelay` (1000), `heartbeatInterval` (30000)
   - `RelayClient` class implementing `vscode.Disposable`:
     - State: `ws`, `status` ('disconnected'|'connecting'|'connected'|'reconnecting'), `clientId`, `userId`
     - `connect(accessToken, refreshToken)` — creates WebSocket to `relayUrl?token=accessToken`
     - `disconnect()` — cleanly close connection
     - `setRequestHandler(handler: (req: WsRequest) => Promise<WsResponse>)` — sets the function to call for incoming requests
     - `sendEnvelope(envelope: RelayEnvelope)` — send raw envelope
     - `sendNotification(method, params, targetUserId?)` — wrap in envelope and send
     - `getStatus()` — current connection status
     - `getClientId()` — assigned client ID (from relay auth response)

   - **Message handling**:
     - On incoming relay envelope (version: "1.0" with payload):
       - Extract payload as WsRequest
       - Call `requestHandler(payload)` → get WsResponse
       - Wrap response in RelayEnvelope with source/target swapped
       - Send back through WS
     - On `ping` from relay: send `pong` response
     - On auth success message: store assigned `clientId` and `userId`

   - **Reconnection**:
     - Exponential backoff: base * 2^attempt + random jitter (0-1000ms)
     - Max 10 retries before giving up
     - On close code 4001 (auth timeout) or UNAUTHORIZED: try `refreshAccessToken()` first

   - **Token refresh**:
     - Store reference to `RelayAuthBridge`
     - On auth failure: call `relayAuthBridge.getRelayTokens()` → reconnect with new token

   - **Events**:
     - `onStatusChanged: vscode.Event<ConnectionStatus>`
     - Fire on connect, disconnect, reconnect, auth failure

2. **Copy/adapt `RelayEnvelope` type** from relay's `types.ts` into extension's types (or create shared type file)

## Attempts / Log

### 2026-02-08 — Attempt 1 (success)
- Created `relayClient.ts` with full `RelayClient` class implementing `vscode.Disposable`
- Local types defined (RelayEnvelope, ClientType, TargetType, ConnectionStatus)
- All public methods: `connect()`, `disconnect()`, `setRequestHandler()`, `sendResponse()`, `getStatus()`, `getClientId()`, `dispose()`
- Private methods: `handleMessage()`, `handleAuthSuccess()`, `handleEnvelope()`, `wrapResponse()`, `scheduleReconnect()`, `reconnect()`, `joinUserGroup()`, `send()`, `setStatus()`, `cancelReconnectTimer()`, `getRelayWsUrl()`
- Reconnection: exponential backoff (1s base, 2x, capped 30s, +jitter), max 10 attempts
- `disconnect()` sets `disposed=true`, cancels timer, prevents reconnects
- `connect()` is idempotent — disconnects first if already connected
- `onStatusChanged` VS Code event fires on all transitions
- TypeScript: 0 errors (`tsc --noEmit` clean)

## Failures

## Notes / Discoveries

## Next Steps

- Proceed to task-000440 (Refactor WsServer and wire RelayClient in extension.ts)
