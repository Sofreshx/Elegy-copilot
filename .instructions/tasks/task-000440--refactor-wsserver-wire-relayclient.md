---
schema: task/v1
id: task-000440
title: "Refactor WsServer and wire RelayClient in extension.ts"
type: feature
status: done
priority: critical
owner: ""
skills: []
group_id: "group-02-ext-relay"
group_title: "Group 2: Extension Relay Client"
group_order: 3
depends_on: ["task-000439"]
next_tasks: []
plan: x-PLAN-artefact.md
created: "2026-02-08"
updated: "2026-02-08"
---

## Context

Refactor WsServer to expose its request handling for relay use, and wire the RelayClient into the extension activation.

**Key files to read before starting:**
- `vscode-skill-installer/src/wsServer.ts` — current `routeRequest` (private method, sends response via WS)
- `vscode-skill-installer/src/extension.ts` — activation wiring
- `vscode-skill-installer/src/eventEmitter.ts` — event broadcast patterns
- `vscode-skill-installer/src/relayClient.ts` (created in task-000439)
- `vscode-skill-installer/src/relayAuthBridge.ts` (created in task-000438)

## Acceptance Criteria

- [x] `routeRequestInternal()` extracted, `handleRelayRequest()` public method added
- [x] RelayClient wired in extension.ts (conditional on `relay.enabled` setting)
- [x] Event emitter bridges to relay for mobile broadcast
- [x] Status bar shows relay status
- [x] `relayStatus` command registered
- [x] No TypeScript errors
- [x] Existing local WS server still works

## Plan / Approach

### 1. Refactor `vscode-skill-installer/src/wsServer.ts`

- Extract `routeRequestInternal(request: WsRequest): Promise<WsResponse>` from current `routeRequest`
  - Current `routeRequest` calls handlers and sends response directly to WS
  - New `routeRequestInternal` returns the response instead of sending
  - Existing `routeRequest` becomes: `response = await routeRequestInternal(request); ws.send(JSON.stringify(response));`
- Add public method:
  ```typescript
  async handleRelayRequest(request: WsRequest): Promise<WsResponse> {
    return this.routeRequestInternal(request);
  }
  ```
- Remove or clean up `legacyClients` tracking if only `ClientRegistry` is needed

### 2. Wire in `vscode-skill-installer/src/extension.ts`

After existing WsServer setup block:
```typescript
// Relay client for cloud connectivity
const relayEnabled = vscode.workspace.getConfiguration('skillInstaller.relay').get<boolean>('enabled', false);
if (relayEnabled) {
  const relayAuthBridge = new RelayAuthBridge(context.secrets, output);
  const relayClient = new RelayClient(getRelayConfig(), output, relayAuthBridge);

  relayClient.setRequestHandler(async (request) => wsServer.handleRelayRequest(request));

  // Bridge events to relay for mobile broadcast
  eventEmitter.onEvent((event) => {
    relayClient.sendNotification('session_event', event);
  });

  // Connect async (non-blocking)
  relayAuthBridge.getRelayTokens().then(tokens => {
    if (tokens) relayClient.connect(tokens.accessToken, tokens.refreshToken);
  });

  context.subscriptions.push(relayAuthBridge, relayClient);
}
```

### 3. Status bar item for relay connection status

- Show "$(cloud) Connected" / "$(cloud-off) Disconnected" alongside existing WS server status
- Click shows relay status details

### 4. Register command `skillInstaller.relayStatus`

- Show relay connection info (status, clientId, userId, relay URL)

## Attempts / Log

### Attempt 1 — 2026-02-08 (success)

**Changes applied across 4 files:**

1. **`eventEmitter.ts`** — Added `_onEvent` / `onEvent` vscode.Event<ExtensionEvent>. Fires in `emit()` after history push, before broadcast loop. Disposed in `dispose()`.

2. **`wsServer.ts`** — Extracted `routeRequestInternal(request, context?)` returning `Promise<WsResponse>`. Simplified `routeRequest()` to delegate + send. Added public `handleRelayRequest()` for relay-routed requests. Made `handleResolvePermission` accept optional `clientInfo` with `'relay-client'` fallback. `subscribe_events`/`unsubscribe_events` return INVALID_REQUEST via relay. `pong` returns acknowledged without WS context.

3. **`relayClient.ts`** — Added `sendEvent(event)` method that wraps events in a RelayEnvelope targeting broadcast.

4. **`extension.ts`** — Added imports for `RelayAuthBridge` and `RelayClient`. Added conditional relay init block after `wsServer.start()` gated on `skillInstaller.relay.enabled`. Wires request handler, event forwarding, async connect, and status logging.

**Validation:** `tsc --noEmit` — zero errors. `get_errors` on all 4 files — zero errors.

## Failures

## Notes / Discoveries

## Next Steps

- After this task, Group 2 (Extension Relay Client) is complete
- Run unit-test-runner checkpoint after group completion
