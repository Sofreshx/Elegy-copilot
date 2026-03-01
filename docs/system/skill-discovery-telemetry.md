---
created: 2026-03-01
updated: 2026-03-01
category: system
status: current
doc_kind: node
id: skill-discovery-telemetry
summary: Deterministic telemetry contract for command-router skill discovery misses and status reporting.
tags: [skills, telemetry, messaging-gateway]
related: [skills-governance, instruction-changelog]
---

# Skill Discovery Telemetry

## Purpose
Define a deterministic telemetry contract for skill discovery misses in `local-tracker` command routing, and surface those metrics in the messaging gateway status file.

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
