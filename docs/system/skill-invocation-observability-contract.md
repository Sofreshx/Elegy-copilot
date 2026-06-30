---
created: 2026-03-18
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: skill-invocation-observability-contract
summary: Concrete v1 contract for correlating skill search, selection, and explicit runtime invocation telemetry through the SDK bridge tool seam.
tags: [skills, telemetry, audit, sdk-bridge, observability]
related: [skill-discovery-telemetry, catalog-control-plane, copilot-sdk-integration-adr]
---

# Skill Invocation Observability Contract

## Purpose

Define the canonical v1 implementation contract for:

- correlating catalog-backed skill search telemetry with explicit runtime tool invocation evidence
- writing authoritative skill invocation audit events from the confirmed SDK bridge seam
- preserving proxy-only visibility when no explicit invocation evidence exists

This contract is intentionally additive to the existing search telemetry and audit surfaces.

## Confirmed anchors in the current codebase

- Search telemetry already persists `asset.search.query`, `asset.search.result`, `asset.search.selected`, and `asset.search.miss` in the shared bounded telemetry file (`copilot-ui/lib/skillSearchService.js`).
- Audit events are appended through `appendCatalogAuditEvent()` and sanitized by `createCatalogAuditEvent()` in `copilot-ui/lib/catalogAuditAnalytics.js`.
- The confirmed explicit runtime write seam is `tool.user_requested -> _runToolHooks()` in copilot-ui/lib/copilot-bridge/index.mjs (historical path, file since removed).
- Asset/repo/session analytics already merge audit events, bounded search telemetry, and session-derived proxy usage in `buildAssetAuditAnalytics()` inside `copilot-ui/lib/catalogAuditAnalytics.js`.

## Final decision

### Event type

Introduce a new audit event type:

- `asset.invoked`

Do **not** reuse `asset.used` for this runtime seam.

### Why `asset.invoked` is the correct v1 contract

1. The product language is explicitly `searched -> selected -> invoked`, so the event name should match the product metric exactly.
2. `asset.used` is semantically broader and would blur:
   - authoritative runtime invocation evidence
   - inferred proxy usage from session artifacts
   - any future non-tool usage signals
3. `asset.invoked` remains generic across asset kinds and avoids baking `skill` into the event name. `assetKind` already carries `skill`, and the same contract can later support explicit agent or prompt invocation if those surfaces become first-class.
4. Keeping `asset.used` untouched preserves backward compatibility for any future broader "used" semantics without forcing a re-meaning of an existing union member.

### Authoritative vs inferred rule

- `asset.invoked` is reserved for **authoritative explicit runtime evidence only**.
- Proxy/inferred usage from `session-state/*/events.jsonl` remains **analytics-only** in v1.
- When authoritative invocation exists for an asset/session pair, proxy usage for that same pair is suppressed from the visible fallback count to avoid double counting.

## Canonical v1 event payload

`asset.invoked` uses the existing audit envelope and adds only the minimum new top-level join fields.

### Top-level fields

These fields are queryable identity/correlation keys and belong at the top level:

```ts
{
  eventId: string;
  eventType: "asset.invoked";
  occurredAt: string;
  actor: {
    kind: "runtime";
    id: "sdk-bridge";
    label: "sdk-bridge";
  };

  assetId: string;
  assetKey: string;
  assetKind: "skill";

  // Asset scope, not runtime repo context.
  scope?: AssetScope;

  // Active runtime repo context for the session when available.
  repoId?: string;

  sessionId: string;
  correlationId?: string;

  // Raw runtime seam identifiers.
  toolName?: string;
  toolCallId?: string;

  details?: {
    observation: "authoritative";
    source: "sdk-bridge";
    sourceEventType: "tool.user_requested";
    resolutionStrategy:
      | "assetId"
      | "assetKey"
      | "skillId"
      | "skillKey"
      | "logicalName"
      | "alias";
    correlationSource:
      | "tool-arguments"
      | "asset.search.selected"
      | "asset.search.query"
      | "none";
    selectedRank?: number;
    searchResultCount?: number;
  };
}
```

### Exact field placement rules

#### Top level

Place these at the top level because they are stable join/filter keys:

- `sessionId`
- `correlationId`
- `assetId`
- `assetKey`
- `assetKind`
- `scope`
- `repoId`
- `toolName`
- `toolCallId`

#### `details`

Place these in `details` because they are bounded explanatory metadata rather than primary keys:

- `observation`
- `source`
- `sourceEventType`
- `resolutionStrategy`
- `correlationSource`
- `selectedRank`
- `searchResultCount`

#### Not stored

Do **not** store:

- raw tool arguments
- prompts or user message text
- repo paths or workspace paths
- arbitrary freeform runtime payload fragments

### Example event

```json
{
  "eventId": "1c40f9d4-d7ff-4d45-b0be-0d4f80a5f3b7",
  "eventType": "asset.invoked",
  "occurredAt": "2026-03-18T14:22:19.401Z",
  "actor": {
    "kind": "runtime",
    "id": "sdk-bridge",
    "label": "sdk-bridge"
  },
  "assetId": "skill-repo-helper",
  "assetKey": "repo-helper",
  "assetKind": "skill",
  "scope": {
    "kind": "repo",
    "repoId": "repo-workspace-repo",
    "displayName": "workspace-repo"
  },
  "repoId": "repo-workspace-repo",
  "sessionId": "session-asset-1",
  "correlationId": "corr-7f1d2b",
  "toolName": "run_skill",
  "toolCallId": "call_123",
  "details": {
    "observation": "authoritative",
    "source": "sdk-bridge",
    "sourceEventType": "tool.user_requested",
    "resolutionStrategy": "assetKey",
    "correlationSource": "asset.search.selected",
    "selectedRank": 1,
    "searchResultCount": 5
  }
}
```

## Resolution and correlation rules

## `assetId`, `assetKey`, and `assetKind`

The invocation writer resolves skill identity in this exact order:

1. `arguments.assetId`
2. `arguments.assetKey`
3. `arguments.skillId`
4. `arguments.skillKey`
5. `arguments.skill`
6. `arguments.skillName`
7. `arguments.name`

Resolution is matched against the effective catalog snapshot for `assetKind === "skill"` using:

1. exact `assetId`
2. exact `assetKey`
3. exact `selectedEntry.metadata.logicalName`
4. exact alias match from `selectedEntry.metadata.aliasKeys`

If no skill asset can be resolved, **no `asset.invoked` event is emitted**. The seam remains best-effort and fail-closed for correctness.

`assetKind` is always `"skill"` for this v1 contract.

## `sessionId`

- `sessionId` is taken directly from the active SDK bridge session record.
- It is expected to be present for every emitted `asset.invoked` event.
- If the bridge record has no valid `sessionId`, the invocation is dropped rather than written partially.

## `toolName`

- `toolName` is copied from `event.data.toolName`.
- It is stored exactly as observed after the same string clamping/sanitization rules used by the audit writer.
- It is never used as the sole skill identity key.

## `toolCallId`

- `toolCallId` is copied from `event.data.toolCallId`.
- It is the primary runtime-level dedupe key for future debugging and replay analysis.
- v1 analytics do not aggregate by `toolCallId`, but it is persisted for traceability and future dedupe if needed.

## `scope` and `repoId`

- `scope` represents the resolved **asset scope** from the effective catalog asset.
- `repoId` represents the **runtime invocation context** for the session.

Precedence for `repoId`:

1. repo derived from the active SDK session cwd via existing repo-state key logic
2. resolved asset scope `repoId`
3. omitted

This separation keeps global skills usable inside repo-scoped sessions without mutating the asset's own scope semantics.

## `correlationId`

`correlationId` must connect runtime invocation back to the search/selection journey when possible.

Resolution precedence:

1. `arguments.correlationId` if present and valid
2. newest matching `asset.search.selected` event in bounded search telemetry with the same:
   - `sessionId`
   - `assetId` or `assetKey`
3. newest `asset.search.query` event in bounded search telemetry with the same `sessionId`
4. omitted

`details.correlationSource` records which rule succeeded.

This keeps correlation deterministic without introducing a second mutable correlation store: v1 reads from the existing bounded `search-telemetry.json` buffer.

## Inferred vs authoritative markers

The marker model is:

- persisted `asset.invoked` event => authoritative by definition
- session-derived usage with no explicit event => proxy/inferred only, analytics layer only

Therefore:

- event payload stores `details.observation = "authoritative"`
- analytics summaries expose both:
  - `explicitInvocationCount`
  - `proxyInferredCount`

Proxy counts are only surfaced when explicit evidence is absent for the same asset/session pair.

## Required backend changes

## Contracts

### `contracts/src/assetCatalog.ts`

Update:

1. `AssetAuditEventType` union
   - add `'asset.invoked'`
2. `AssetAuditEvent`
   - add optional top-level `toolName?: string`
   - add optional top-level `toolCallId?: string`

No new event family-specific nested object is required in v1. Existing `details` remains sufficient once the top-level join keys are added.

## Audit writer and analytics

### `copilot-ui/lib/catalogAuditAnalytics.js`

Update:

1. `createCatalogAuditEvent()`
   - sanitize and persist `toolName`
   - sanitize and persist `toolCallId`
2. `sanitizeDetails()`
   - explicitly allow bounded invocation metadata keys:
     - `observation`
     - `source`
     - `sourceEventType`
     - `resolutionStrategy`
     - `correlationSource`
     - `selectedRank`
     - `searchResultCount`
3. `buildAssetAuditAnalytics()`
   - ingest `asset.invoked` from audit log
   - increment explicit invocation counters at asset/repo/session rollups
   - track authoritative asset/session pairs for proxy suppression
   - keep proxy session-derived usage additive only when no authoritative invocation exists for that pair
4. analytics response shape
   - extend `usage` summaries with:
     - `invocationCount`
     - `explicitInvocationCount`
     - `proxyInferredCount`
     - `evidence`
   - add `searchedCount` aliases for product reporting while preserving current raw search counters

### Suggested summary shape additions

For assets:

```ts
usage: {
  invocationCount: number;         // visible total after proxy suppression
  explicitInvocationCount: number; // from asset.invoked
  proxyInferredCount: number;      // from session-derived fallback only
  sessionCount: number;
  repoCount: number;
  evidence: "none" | "proxy-only" | "authoritative" | "mixed";
}
search: {
  sampled: {
    queryCount: number;
    resultCount: number;
    searchedCount: number; // alias of resultCount for asset grain
    selectedCount: number;
    missCount: number;
  };
  lastEventAt: string | null;
}
```

For repos and sessions:

```ts
search: {
  queryCount: number;
  searchedCount: number; // alias of queryCount
  resultCount: number;
  selectedCount: number;
  missCount: number;
}
usage: {
  invocationCount: number;
  explicitInvocationCount: number;
  proxyInferredCount: number;
  evidence: "none" | "proxy-only" | "authoritative" | "mixed";
}
```

## Runtime bridge integration

### copilot-ui/lib/copilot-bridge/index.mjs (historical path, file since removed)

Add a dedicated optional hook for runtime tool observations:

- session config key: `onToolUserRequested`
- stored in `record.hooks`
- invoked from `_runToolHooks()` when `event.type === "tool.user_requested"`

Payload:

```ts
{
  kind: "tool";
  sessionId: string;
  toolName?: string;
  toolCallId?: string;
  arguments?: unknown;
}
```

This preserves the current policy hooks and keeps telemetry separate from permission/preflight logic.

### `copilot-ui/server.js`

Wire the bridge with a new telemetry observer created at startup:

- create the bridge observer once in the backend composition root
- pass it into SDK session creation/config so every runtime session shares the same write path

## New helper

Create:

- copilot-ui/lib/assetInvocationTelemetry.js (historical path, file since removed)

Responsibilities:

1. resolve repo context from SDK session metadata
2. load or rebuild the effective catalog snapshot for that repo context
3. resolve the invoked skill from tool arguments
4. load bounded search telemetry and derive `correlationId`
5. append `asset.invoked` through `appendCatalogAuditEvent()`
6. fail closed without breaking runtime event processing

Exports:

- `createAssetInvocationTelemetryWriter(options)`
- `recordAssetInvocationFromToolRequest(toolRequest, context)`

This isolates catalog semantics from the generic SDK bridge module.

## Existing routes that change behavior

### `GET /api/audit/events`

No new route is needed.

Behavior change:

- `eventType=asset.invoked` must be queryable through the existing filter path.

### `GET /api/audit/assets`

No new route is needed.

Behavior change:

- response rollups must now distinguish searched, selected, and invoked
- invocation counts must show explicit vs proxy fallback separately

### `POST /api/search/query` and `POST /api/search/selection`

No payload contract change is required.

Their existing persisted telemetry is the correlation substrate for `asset.invoked`.

## Data flow

1. `POST /api/search/query`
   - writes `asset.search.query`
   - writes `asset.search.result` or `asset.search.miss`
2. `POST /api/search/selection`
   - writes `asset.search.selected`
3. runtime emits `tool.user_requested`
4. SDK bridge `_runToolHooks()` invokes `onToolUserRequested`
5. `assetInvocationTelemetry`:
   - resolves skill identity from tool arguments
   - resolves repo context from session
   - looks up correlation from bounded search telemetry
   - appends `asset.invoked`
6. `GET /api/audit/assets`
   - aggregates:
     - search telemetry
     - audit log lifecycle events
     - explicit `asset.invoked`
     - proxy session-derived fallback
   - suppresses proxy fallback when authoritative invocation already exists

## Privacy and boundedness rules

The new contract must match the existing privacy-safe posture:

1. no raw tool arguments persisted
2. no repo/workspace paths in audit payloads
3. string fields clamped with existing audit limits
4. search correlation reads only the existing bounded recent telemetry buffer
5. no new unbounded append-only store beyond the existing audit JSONL
6. all best-effort failures are swallowed after logging decision boundaries; runtime tool execution must not fail because telemetry failed

## Tests to add or update

## Contracts

### `contracts/tests/assetCatalog.test.js`

Add assertions that the published contract includes:

- `asset.invoked` in the audit event type surface
- optional `toolName` / `toolCallId` fields on emitted audit event shapes

## SDK bridge

### `copilot-ui/lib/copilot-bridge/sdk-bridge.test.cjs`

Add coverage that:

- `tool.user_requested` invokes the new `onToolUserRequested` hook
- hook failures remain non-fatal
- payload includes `sessionId`, `toolName`, `toolCallId`, and arguments

## Audit writer / analytics

Create:

- copilot-ui/lib/catalogAuditAnalytics.test.js (historical path, file since removed)

Add coverage for:

1. `asset.invoked` sanitization
   - stores `toolName`
   - stores `toolCallId`
   - drops raw argument/path-like content
2. analytics rollups
   - explicit invocation increments `explicitInvocationCount`
   - proxy usage remains visible only when no explicit invocation exists
   - `searchedCount`, `selectedCount`, and `invocationCount` all report independently
3. correlation preservation
   - invocation event carries the selection correlation id when available

## Search + route integration

### `copilot-ui/routes/catalog.test.js`

Extend the existing audit analytics route test so it asserts:

- an explicit `asset.invoked` event appears in recent analytics feed
- the matching asset shows `usage.explicitInvocationCount >= 1`
- the asset still shows `search.sampled.selectedCount >= 1`
- proxy fallback does not double count once explicit evidence exists

### `copilot-ui/tests/skill-search-service.test.js`

Keep current telemetry tests and add one integration-oriented case that confirms correlation lookup inputs stay available in persisted bounded telemetry:

- selected event includes `assetId`
- selected event includes `correlationId`
- query/result/selection sequence is sufficient for later invocation lookup

## Implementation sequence

1. **Contracts**
   - add `asset.invoked`
   - add top-level `toolName` and `toolCallId`
2. **Bridge seam**
   - add `onToolUserRequested` hook to `SdkBridgeService`
   - cover with bridge tests
3. **Invocation writer**
   - add `assetInvocationTelemetry.js`
   - resolve asset + correlation + repo context
   - append `asset.invoked`
4. **Analytics**
   - ingest explicit invocation events
   - add explicit/proxy split and suppression logic
   - expose searched/selected/invoked counts cleanly
5. **Route verification**
   - update audit analytics route tests
   - keep `/api/audit/events` and `/api/audit/assets` surfaces additive

## Non-goals for v1

- no backfill migration that rewrites old `asset.used` events
- no attempt to persist raw runtime arguments for debugging
- no guarantee that every skill invocation will resolve explicitly if the runtime tool payload does not contain a resolvable skill identity
- no replacement of session-derived proxy usage until explicit runtime coverage is proven sufficient
