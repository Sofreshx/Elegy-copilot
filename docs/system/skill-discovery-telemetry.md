---
created: 2026-03-01
updated: 2026-03-09
category: system
status: current
doc_kind: node
id: skill-discovery-telemetry
summary: Deterministic telemetry contracts for command-router misses and shared catalog-backed skill search evaluation.
tags: [skills, telemetry, messaging-gateway, catalog]
related: [catalog-control-plane, skills-governance, instruction-changelog]
---

# Skill Discovery Telemetry

## Purpose
Define deterministic telemetry contracts for:

- skill discovery misses in `local-tracker` command routing, surfaced in the messaging gateway status file
- shared catalog-backed skill search in `copilot-ui/lib/skillSearchService.js`, persisted as
  bounded local evaluation telemetry
- asset-centric audit analytics and runtime verification surfaces exposed by the `copilot-ui`
  control plane

## Contract

- `contractVersion`: `skill_discovery_telemetry_v1`
- `miss reasons` (closed set):
  - `keyword_miss`
  - `ambiguity`
  - `stale_map`
  - `no_route`
- `sample`: bounded recent-buffer metadata
  - `capacity` (fixed small cap)
  - `size` (current retained samples)
  - `dropped` (evictions due to bounded cap)
  - `deterministic: true`
- `countersByReason`: monotonically increasing per-process counters for all miss reasons

## Shared catalog search telemetry

- `contractVersion`: `skill_search_telemetry_v1`
- persistence path: `~/.copilot/catalog/search-telemetry.json`
- primary API surfaces:
  - `POST /api/search/query`
  - `POST /api/search/selection`
- bounded recent buffer metadata:
  - `capacity` (fixed retained event cap)
  - `size` (current retained events)
  - `dropped` (evictions caused by the cap)
  - `deterministic: true`
  - `maxResultsPerEvent` (bounded ranked result sample per event)
- `countersByEventType`:
  - `asset.search.query`
  - `asset.search.result`
  - `asset.search.selected`
  - `asset.search.miss`
- `countersByMissReason`:
  - `empty-catalog`
  - `no-match`
  - `all-filtered`

Recorded event payloads must stay explicit and privacy-safe:

- query text is normalized and truncated before persistence
- repo/workspace identity is stored via IDs, not raw workspace paths
- result samples are capped to top-ranked asset IDs, keys, scores, and explanation codes
- selection events store selected asset identity plus bounded rank/score context

Search storage is shared across UI/API/CLI flows so `scripts/skill-search.mjs` and the dashboard
observe the same telemetry contract.

## Asset audit analytics projection

- `contractVersion`: `asset_audit_analytics_v1`
- catalog audit log path: `~/.copilot/catalog/audit/events.jsonl`
- backend query surfaces:
  - `GET /api/audit/events`
  - `GET /api/audit/assets`
  - `POST /api/search/selection`
- asset analytics merge three bounded/local sources:
  - lifecycle audit events (`asset.lifecycle.*`) from install/remove hooks and projection-diff repo overlay changes
  - shared search telemetry (`asset.search.query|result|selected|miss`)
  - session-derived usage rollups from local `session-state/*/events.jsonl`

Operational expectations:

- repo/workspace paths stay out of persisted audit payloads; only repo/workspace IDs or display labels are retained when available
- lifecycle diffs are rebuild-safe and only synthesize repo-local create/update/remove plus enable/disable transitions that are observable from local projection state
- asset-centric search rollups are sample-based when they come from bounded search telemetry; route consumers should read `telemetry.sample` metadata before treating them as exhaustive totals

## Projection and runtime surfaces

The catalog telemetry and analytics model depends on local projection/runtime files under
`~/.copilot/catalog/`:

- `projections/global.json`
- `projections/repo-<repoId>.json`
- `repo-inventory.json`
- `search-telemetry.json`
- `audit/events.jsonl`

Runtime verification surface:

- `GET /api/runtime/catalog-health`

This health endpoint currently reports projection availability, freshness/read mode, rebuild state,
audit file metadata, and backend change-tracker metadata.

## Bootstrap and verification notes

Bootstrap for the catalog telemetry stack is a projection refresh, not a separate migration. The
minimum verification path is:

1. rebuild the catalog projection (`POST /api/catalog/refresh`)
2. issue a search (`POST /api/search/query`)
3. record a selection if applicable (`POST /api/search/selection`)
4. inspect analytics (`GET /api/audit/assets`)
5. inspect health (`GET /api/runtime/catalog-health`)

## Ingestion Points

Telemetry is recorded in `CommandRouter` at natural miss boundaries:

- `keyword_miss`: unknown command names (command token did not resolve)
- `ambiguity`: ambiguous `/switch` workspace resolution (name/repo collisions)
- `stale_map`: workflow lookups where requested definition is missing (`/workflow inspect|run` not found)
- `no_route`: command argument misses (`zod` validation failures during routing)

## Status Contract Surface

`MessagingGatewayStatusV1.runtime.discoveryTelemetry` includes:

- `contractVersion`
- `sample` (capacity/size/dropped/deterministic)
- `countersByReason`
- `recent` sampled miss records (bounded)

Normalization requirements:

- Legacy (`v0`) or partial status inputs normalize to canonical `v1` shape.
- Missing discovery telemetry fields are defaulted deterministically.
- Invalid/missing reason keys default safely without widening the reason enum.

## Operational Notes

- Sampling is bounded to avoid unbounded memory growth.
- Status refresh reads telemetry from the live router summary and projects it into runtime status.
- Startup summary logs telemetry contract and sampling configuration for quick operator visibility.
- Shared catalog search telemetry is rebuild-safe operational data: it must remain bounded,
  explicit, and suitable for deterministic offline evaluation of query/result/selection quality over
  time.
