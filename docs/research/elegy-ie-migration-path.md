---
created: 2026-03-06
updated: 2026-03-06
category: research
status: draft
doc_kind: node
id: elegy-ie-migration-path
summary: Draft phased migration path from IE markdown-first agentic definitions to Elegy contract-backed canonical models.
tags: [elegy, instruction-engine, migration, contracts]
---

# Elegy to IE Migration Path

## Purpose

Define a phased migration strategy from current instruction-engine markdown-first assets to Elegy contract-backed agentic models without breaking existing workflows.

## Inputs

- Field mapping draft: `docs/research/elegy-ie-agentic-field-mapping.md`
- Compatibility controls: `contracts/elegy/compatibility-matrix.json`
- Elegy reference pattern: `Elegy/docs/migration/extraction-matrix.md`

## Phase 1: Bridge Baseline (IE-canonical)

Entry criteria:
- Agentic schemas are synced under `contracts/elegy/`.
- Type stubs exist in `contracts/src/agentic.ts`.

Actions:
- Validate schema presence and manifest linkage via `scripts/validate-agentic-schemas.js`.
- Keep IE markdown assets as canonical authoring source.

Exit criteria:
- Validation passes in CI for schema sync and contract package build.
- No behavior change to existing skill or agent loading.

## Phase 2: Dual-Write Metadata (Bridge-canonical)

Entry criteria:
- Phase 1 checks stable for one release cycle.
- High-risk mapping gaps tracked from field mapping doc.

Actions:
- Add optional structured metadata blocks in skill and agent frontmatter (`id`, `lifecycleState`, `scope`).
- Build deterministic extraction adapters for routing rules and constraints.
- Generate schema-shaped snapshots for review.

Exit criteria:
- Snapshot parity reports show no unresolved critical mismatches.
- Governance review approves metadata conventions.

## Phase 3: Elegy-canonical with IE projection

Entry criteria:
- Dual-write adapters are reliable and low-noise.
- Compatibility matrix includes supported version ranges for producer and consumer.

Actions:
- Treat Elegy contracts as canonical for agentic entities.
- Project markdown artifacts from contract-backed definitions where needed.
- Keep backward compatibility through compatibility-matrix gates.

Exit criteria:
- Contract-first pipeline is default.
- IE markdown projections remain stable and validated.

## Risk Controls

- Use compatibility ranges in `contracts/elegy/compatibility-matrix.json` to gate rollout by version.
- Keep additive changes only until parity is proven.
- Maintain rollback path by preserving source markdown files during dual-write.

## Rollback Strategy

- If adapter quality degrades, revert to Phase 1 behavior: IE markdown remains sole canonical source.
- Continue syncing schemas and stubs while pausing projection writes.
- Re-open mapping gaps in the field mapping research doc before another migration attempt.
