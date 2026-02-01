---
schema: task/v1
id: task-000001
title: "ORLEANS-P5-1: Feature Flag Infrastructure for Orleans Evolution"
type: feature
status: not-started
priority: high
owner: "unassigned"
skills: ["feature-creator","orleans","frontend","docs"]
depends_on: ["ORLEANS-P1-3", "ORLEANS-P2-4", "ORLEANS-P3-4", "ORLEANS-P4-2"]
next_tasks: []
created: "2026-01-30"
updated: "2026-01-30"
---

## Context
- Multiple features for the Orleans workflow evolution require staged rollouts via feature flags.
- Need consistent naming, central documentation, per-tenant overrides, and an admin UI/endpoint for toggling flags.

## Acceptance Criteria
- [ ] Document all Orleans evolution flags in one place
- [ ] `Orleans.Persistence.UseMarten` (Phase 1)
- [ ] `Orleans.WorkflowExecution.UseGrains` (Phase 2)
- [ ] `Tools.DynamicTools.Enabled` (Phase 3)
- [ ] `Connections.ScopingEnabled` (Phase 4)
- [ ] Per-tenant override support
- [ ] Feature flag dashboard/admin UI endpoint

## Plan / Approach
1. Inventory existing feature flags across the repo and services.
2. Consolidate naming convention and create `Api/Tools.Api/Orleans/OrleansFeatureFlags.cs` with constants/metadata.
3. Implement per-tenant override mechanism (config + DB-backed overrides) and ensure DI wiring.
4. Add admin API: `Api/Tools.Api/Features/Admin/FeatureFlagEndpoints.cs` to expose read/modify and a dashboard endpoint.
5. Add docs to `docs/orleans-rollout.md` including rollout guidance and per-tenant override examples.
6. Add integration tests and a small UI stub for toggling flags in staging.

## Files to Modify / Create
- `Api/Tools.Api/Orleans/OrleansFeatureFlags.cs` (modify/create)
- `Api/Tools.Api/Features/Admin/FeatureFlagEndpoints.cs` (new)
- `docs/orleans-rollout.md` (docs)

## Acceptance Tests / Validation
- Unit tests for flag parsing and tenant overrides.
- Integration test for admin endpoint and a staged rollout scenario.

## Next Steps
- Assign an owner and start with an inventory PR that lists all flags and proposed namespaces.
