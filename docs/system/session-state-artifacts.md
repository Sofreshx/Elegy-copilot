---
created: 2026-02-23
updated: 2026-02-27
category: system
status: current
doc_kind: node
id: session-state-artifacts
summary: Canonical contract for Elegy session-state artifacts (plan.md, proposition.md, verification-guide.md) and progress tracker structure.
tags: [session-state, elegy]
---

# Session State Artifacts

This document defines the canonical contract for Elegy session state artifacts, ensuring agents and UI tools agree on what to write and read.

## Canonical Session Root

All session state lives under:

```
~/.copilot/session-state/<SESSION_ID>/
```

On Windows:
```
%USERPROFILE%\.copilot\session-state\<SESSION_ID>\
```

## Artifact Layout

A typical session directory contains:

```
~/.copilot/session-state/<SESSION_ID>/
  plan.md              # Plan Pack + Progress Tracker (canonical)
  proposition.md       # Append-only guidance artifact
  verification-guide.md  # Structured verification guide (optional)
  plans/               # Plan revisions
    index.json         # Revision metadata
    rev-0001.md        # First revision
    rev-0002.md        # Second revision, etc.
```

### Plan Artifact (`plan.md`)

The plan artifact contains **two top-level documents in one markdown file**:

1. **Plan Pack** — High-level plan structure, work unit specifications, dependencies, risks
2. **Plan-Pack Progress Tracker** — Live execution state (status tables, checkpoints, next unit)

This dual-document approach matches the output of `@o-planner` and `@elegy-planner`.

### Proposition Artifact (`proposition.md`)

An append-only file that accumulates guidance at key milestones:
- **direction** — Initial direction from `@elegy-direction`
- **after-planning** — Suggestions after plan approval
- **after-execution** — Retrospective notes after execution completes

Each entry uses an H2 heading:
```markdown
## 2026-02-23T14:30:00Z — after-planning — elegy-planner

### Summary
- Plan approved with 3 work unit groups
- Key risk: external API dependency needs stub
- Recommended: start with G-01 (foundation work)

### Details
The plan prioritizes foundational changes before UI work to minimize rework...
```

### Verification Guide Artifact (`verification-guide.md`)

A structured guide for verifying changes made during a session's execution phase.

| Property | Value |
|---|---|
| **Write semantics** | Overwrite (full replace on each write) |
| **Lifecycle** | Written by `@elegy-orchestrator` at finalization, after `@final-reviewer` completes |
| **Optional** | Yes — not created if `@verification-guide` agent fails or is skipped |

#### Format

The file is Markdown with these top-level sections:

1. **Summary** — One-paragraph overview of what was changed and why
2. **Changed Files** — List of files modified/created/deleted during execution
3. **Where to Verify** — Pointers to the areas the reviewer should inspect (type-prefixed: UI, Terminal, Browser, File, API, Config)
4. **Verification Steps** — Ordered checklist of manual or automated steps to confirm correctness
5. **Expected Outcomes** — What the reviewer should observe when verification succeeds

#### API Access

The copilot-ui dashboard exposes this artifact via:

```
GET /api/sessions/:id/verification-guide
```

Returns `{ id, source, content }` with the raw Markdown content, or `404` if the artifact was not generated for the session.

## Planning Semantic Contract (WS3)

Contract-layer semantic scoring and gate evaluation uses a versioned deterministic contract:

- `SEMANTIC_SCORING_CONTRACT_VERSION = semantic_scoring_v1`
- deterministic candidate scoring shape from `scorePlanningCandidate(input)`
- stable ordering from `sortPlanningCandidates(candidates)`

### Degraded Lexical Fallback Flags

`determineSemanticDegradedMode(input)` returns:

- `degraded` (boolean)
- `degradedMode` (`semantic_primary` or `lexical_fallback`)
- `degradedReasons` (sorted reason-code array)
- `semanticUsed` (boolean)

Required trigger coverage includes semantic-disabled, semantic timeout/error, embedding availability/lifecycle, and semantic gate insufficient-data/failure conditions.

### Embedding Lifecycle States

`classifyEmbeddingLifecycle(record)` normalizes record state into one of:

- `ready`
- `needsBackfill`
- `needsReembed`
- `poisoned`

Response includes deterministic `reasonCodes` plus retry/backpressure markers:

- `retryMarker` for backfill/re-embed retries
- `backpressureMarker` when retry/queue pressure thresholds are exceeded

### Semantic Gate States (Fail-Closed)

`evaluateSemanticGate(metrics, thresholds)` evaluates latency/error/quality and enforces fail-closed behavior:

- `pass`
- `fail`
- `insufficient-data` (always blocks semantic merge)

`mergeEnabled` is true only when gate state is `pass` and threshold `mergeEnabled` is true.

Override envelope shape is versioned and deterministic:

```json
{
  "contractVersion": "semantic_gate_override_v1",
  "gateStatus": "pass|fail|insufficient-data",
  "mergeEnabled": false,
  "overrideRequired": true,
  "overrideEligible": true,
  "requested": false,
  "approved": false,
  "insufficientData": true,
  "reasons": ["insufficient_data"]
}
```

## Planning API Contract (WS4)

Planning APIs expose a deterministic contract envelope:

- `contractVersion = planning_api_v1`
- `kind` identifies endpoint contract (`planning.create`, `planning.list`, `planning.search`, `planning.compare`)
- `deterministic = true` is always present

### Planning Persistence Authority (G-01-WU-01)

The persistence authority for planning records and planning notes is frozen as follows:

1. Canonical persisted store
  - The existing local DB persistence layer (`copilot-ui/lib/planningPersistence.js`) is the only canonical persisted store for planning records/notes.

2. API read/write source of truth
  - `POST /api/planning/records`, `GET /api/planning/records`, `GET /api/planning/search`, and `POST /api/planning/compare` MUST read/write persisted planning data through the local DB persistence layer.

3. Artifact non-authority
  - Session artifacts (`plan.md`, `proposition.md`, `verification-guide.md`) are orchestration artifacts and MUST NOT be treated as canonical planning-record persistence.

4. No file fallback writes
  - Implementations MUST NOT silently fall back to file-based persistence for planning records/notes when local DB persistence is unavailable.
  - Persistence failures must remain explicit and deterministic to callers.

### Planning Persistence Operations Contract (WS4 M2)

The WS4 M2 operational APIs are additive and machine-deterministic:

1. Retention engine
  - `POST /api/planning/persistence/retention` supports `dry-run` and `execute` modes.
  - Both modes return deterministic report envelopes including retention policy, candidate counts, and record-id lists.
  - `dry-run` must not mutate persisted rows; `execute` may delete only records selected by the deterministic cutoff policy.

2. Export contract
  - `POST /api/planning/persistence/export` returns a deterministic snapshot envelope with:
    - snapshot contract version,
    - sorted canonical records,
    - record count,
    - checksum.
  - Export is read-only and additive; it must not mutate persistence state.

3. Import contract
  - `POST /api/planning/persistence/import` accepts exported snapshot shape (or a compatible `{ records: [...] }` payload).
  - Import behavior is idempotent on repeated identical payloads (replays produce no duplicate durable writes).
  - Conflicting duplicate record IDs within a single payload fail closed with explicit deterministic code/reason.

4. Corruption-aware write safety
  - Import and retention execute mode are write operations and must respect corruption recovery write blocks.
  - When recovery is required, write operations fail closed with explicit deterministic marker (`planning_persistence_recovery_required`).

### WS4 M3 Closure Freeze + Evidence Contract

WS4 M3 closes governance scope for persistence operations and freezes evidence expectations before WS5A durability expansion.

1. Freeze criteria (all required)
  - migration checksum baseline remains fixed and deterministic
  - planning health/governance contract fields remain additive and stable
  - corruption-recovery write block markers remain explicit and fail-closed
  - tracker/coprocess path + idempotency semantics remain aligned with planning governance assumptions

2. Required WS4 gate evidence pack
  - `node copilot-ui/lib/planningPersistence.test.js`
  - `node copilot-ui/lib/planningApiContracts.test.js`
  - `node copilot-ui/server.runtime-health.test.js`
  - `npm --prefix local-tracker run test:jest -- src/messagingGateway/__tests__/lifecycleOperations.test.ts src/messagingGateway/__tests__/gatewayHttpServer.test.ts`

3. Path/idempotency checkpoint expectations
  - gateway config path resolution is deterministic and tracker-compatible (`INSTRUCTION_ENGINE_GATEWAY_CONFIG_PATH` override; canonical default under `~/.instruction-engine`)
  - status artifact path remains deterministic and machine-global (`~/.instruction-engine/messaging-gateway.status.json`)
  - lifecycle finish retries preserve canonical sandbox ID and idempotency conflict envelopes stay explicit (`idempotency_conflict`, `idempotency_key_payload_mismatch`)

4. Gate decision
  - **Pass**: all evidence commands exit `0` and required deterministic markers are present.
  - **Fail**: any command fails, required marker is missing/changed, or path/idempotency semantics drift.

### Runtime Provider State Authority (G-02-WU-01)

Provider selection/state is normalized through one canonical path:

1. Canonical model
  - Provider state is normalized to `{ contractVersion, selectedProvider, defaultProvider, selectionSource }`.
  - Allowed providers are `non-docker` and `docker` only.

2. Default behavior (non-Docker primary)
  - If no explicit valid selected provider exists, `selectedProvider` MUST resolve to `defaultProvider`.
  - If no valid default provider exists, `defaultProvider` MUST resolve to `non-docker`.

3. Migration behavior
  - Absent provider state and legacy provider fields are migrated into the canonical model deterministically.
  - Invalid persisted/env provider values are ignored safely and fall back to canonical defaults.
  - Migration metadata must be deterministic (`required`, sorted `reasonCodes`, source markers).

4. Scope boundary
  - This authority governs backend/provider resolution only (WS2).
  - It MUST NOT introduce WS4 UX behavior changes.

### Provider Capability-Gated Parity Contract (G-02-WU-02)

Lifecycle provider capability behavior is frozen as follows:

1. Shared lifecycle capability parity
  - Shared lifecycle capabilities are `create`, `start`, `stop`, and `open-terminal`.
  - For all supported providers, shared capabilities MUST be contract-equivalent in request/response behavior.
  - Provider selection MUST NOT alter the envelope shape for shared lifecycle capability success paths.

2. Non-shared capability handling
  - Non-shared lifecycle capabilities MAY differ by provider.
  - When a capability is unsupported for the selected provider, the API MUST fail closed with deterministic explicit markers.
  - Unsupported marker envelope includes:
    - `error = "Lifecycle capability unsupported"`
    - `code = "lifecycle_capability_unsupported"`
    - `action` (requested lifecycle action)
    - `deterministic = true`
    - `unsupported.marker = "unsupported"` and provider/reason metadata

3. Scope boundary
  - This contract applies to WS2 backend capability gating only.
  - It does not introduce WS4 finish-flow UX behavior.

### Session Reconciliation Authority and Precedence Contract (G-03-WU-01)

Reconciliation authority between runtime state and filesystem/session artifacts is frozen as a deterministic contract:

1. Canonical authority labels (backward-compatible)
  - `acp` = both runtime and artifact state are present; runtime is authoritative for reconciliation.
  - `acp-only` = runtime state present without matching artifact state.
  - `fs` = artifact state present without runtime state, or no runtime signal is available.

2. Deterministic source precedence
  - Source precedence is always `runtime > artifact`.
  - Reconciliation source metadata is normalized to `runtime` and `artifact` only.

3. Source-of-truth resolution matrix
  - runtime + artifact -> `authority=acp`, `sourceOfTruth=runtime`, `sourcePrecedence=["runtime","artifact"]`
  - runtime only -> `authority=acp-only`, `sourceOfTruth=runtime`, `sourcePrecedence=["runtime"]`
  - artifact only (or neither source asserted) -> `authority=fs`, `sourceOfTruth=artifact`, `sourcePrecedence=["artifact"]`

4. Frozen helper/export contract
  - `copilot-ui/lib/runtimeContracts.js` exports:
    - `SESSION_RECONCILIATION_CONTRACT_VERSION`
    - `SESSION_STATE_AUTHORITIES`
    - `SESSION_RECONCILIATION_SOURCES`
    - `SESSION_RECONCILIATION_SOURCE_PRECEDENCE`
    - `SESSION_RECONCILIATION_SOURCE_OF_TRUTH`
    - `normalizeSessionReconciliationSource(input)`
    - `getSessionReconciliationSourcePrecedence(input)`
    - `resolveSessionReconciliationAuthority(input)`
  - `copilot-ui/lib/planState.js` exports planning precedence contract helpers consumed by deterministic conflict ordering:
    - `PLANNING_PRECEDENCE_CONTRACT_VERSION`
    - `PLANNING_SCOPE_PRECEDENCE`
    - `PLANNING_RECORD_PRECEDENCE_RULES`
    - `getPlanningScopePrecedence(record)`

5. Compatibility constraints
  - Existing authority tokens (`acp`, `acp-only`, `fs`) remain unchanged.
  - Existing consumer behavior remains additive and deterministic; this work freezes contract semantics for reconciliation without changing endpoint envelopes.

### Reconciliation Invariant Checkpoint (G-03-WU-05)

Use this repeatable checkpoint to validate reconciliation authority precedence, stale/conflict determinism, and recovery-visible outputs:

```bash
node copilot-ui/lib/sessionAggregation.test.js
node copilot-ui/lib/runtimeContracts.test.js
node copilot-ui/lib/planningApiContracts.test.js
node copilot-ui/server.lifecycle-proxy.test.js
node copilot-ui/server.runtime-health.test.js
```

Checkpoint pass criteria:
- all commands exit `0`
- authority precedence remains deterministic (`runtime > artifact`) with canonical authorities `acp`, `acp-only`, and `fs`
- stale/conflict downgrade markers are deterministic (sorted + deduped marker collections and reason codes)
- recovery markers remain explicit and stable (`recovery_checkpoint_only`, `recovery_ledger_only`, `recovery_missing_both`)
- merged all-source session output includes reconciliation metadata (`authority`, `sourceOfTruth`, `sourcePrecedence`, `sourceSet`)

### Finish Compatibility Hook Contract (G-02-WU-03)

WS2 publishes a deterministic, provider-agnostic finish compatibility hook contract for WS4 consumption.

1. Hook envelope
  - Hook envelope is additive and backward compatible.
  - Hook shape:
    - `contractVersion = "1"`
    - `apiContractVersion = planning_api_v1`
    - `kind = "lifecycle.finish.compatibility-hook"`
    - `deterministic = true`
    - `action = "finish"`
    - `providerAgnostic = true`
    - `supportedProviders = ["docker", "non-docker"]` (sorted deterministically)
    - `scopeBoundary = "ws2_contract_hook_only"`
    - `ws4Ownership = "finish_behavior_and_ux"`

2. Receipt contract
  - Hook includes deterministic receipt schema metadata only (no finish behavior execution in WS2):
    - `receipt.contractVersion = "1"`
    - `receipt.kind = "lifecycle.finish.receipt"`
    - `receipt.deterministic = true`
    - `receipt.providerAgnostic = true`
    - `receipt.requiredFields = ["deterministic", "hookContractVersion", "issuedAt", "outcome", "provider", "receiptId", "resolvedAt", "status"]`
    - `receipt.optionalFields = ["metadata", "reason"]`

3. Publication points
  - The hook contract is present in lifecycle capability envelopes and lifecycle unsupported-marker envelopes.
  - Runtime health also exposes the same hook contract as a compatibility publication point for WS4 clients.

4. Scope boundary
  - WS2 owns publishing this contract/hook only.
  - WS4 owns finish behavior, finish sequencing, PR prompt UX, and closure UX implementation.

### Cross-WS Canonical Sandbox ID Invariant (G-04-WU-04)

The finish proxy contract must preserve canonical edited sandbox IDs across WS2 provider-state authority and WS4 lifecycle behavior:

1. Canonical ID lock
  - The first successful create response defines the canonical persisted sandbox ID.
  - Once persisted, canonical edited sandbox IDs MUST NOT be rewritten by provider SSOT normalization or migration processing.
  - Provider-state migration metadata may be reported, but it is non-authoritative for sandbox ID rewriting.

2. Finish proxy parity
  - `POST /api/tracker/lifecycle/finish` supports both deterministic finish paths:
    - no PR path (`prAction = "skip-pr"`)
    - PR path (`prAction = "open-pr"` with required `baseBranch` and `headBranch`)
  - For both paths, canonical sandbox ID must remain consistent across returned finish surfaces (`result.sandboxId`, `result.close.result.sandboxId` when present).

3. Deterministic invariant violation marker
  - If the finish proxy observes a canonical ID rewrite attempt/mismatch, it fails closed with a deterministic envelope:

```json
{
  "error": "Lifecycle canonical sandboxId invariant violated",
  "code": "canonical_sandbox_id_invariant_violation",
  "action": "finish",
  "reason": "canonical_sandbox_id_mismatch",
  "deterministic": true,
  "invariant": {
    "marker": "conflict",
    "scope": "cross_ws_canonical_id",
    "expectedSandboxId": "<persisted-canonical-id>",
    "receivedSandboxId": "<mismatched-id>",
    "receivedPath": "result.sandboxId|result.close.result.sandboxId",
    "reasonCodes": ["..."]
  }
}
```

  - Violation status code is `409` and reason-code ordering is deterministic (sorted + deduped).

### Endpoints

- `POST /api/planning/records` (create)
- `GET /api/planning/records` (list)
- `GET /api/planning/search` (search)
- `POST /api/planning/compare` (compare)

### Idempotency Semantics

`POST /api/planning/records` and `POST /api/planning/compare` require idempotency keys.

Response includes deterministic idempotency metadata:

```json
{
  "idempotency": {
    "key": "<idempotency-key>",
    "scopeKey": "<operation-scope>",
    "replay": false,
    "conflict": false,
    "ttlMs": 600000,
    "expiresAt": "2026-02-26T00:10:00.000Z",
    "outcome": "applied|replay|conflict|expired_reapplied"
  }
}
```

Behavior:

- same key + same scope + same canonical payload within TTL → replay-safe response (`outcome=replay`)
- same key + same scope + different payload within TTL → conflict (`idempotency_conflict`)
- expired key → treated as a new execution with explicit `expired_reapplied`

### Planning Persistence Health Governance Envelope (WS4 M1)

`/api/health` and planning persistence init/failure surfaces include a deterministic governance envelope:

- `planningPersistence.governance.deterministic = true`
- `planningPersistence.governance.failClosed = true`
- explicit `planningPersistence.governance.code` and `planningPersistence.governance.reason`
- sorted `planningPersistence.governance.reasonCodes`

This envelope remains additive and backward compatible.

### Migration Baseline Governance + Checksum Enforcement (WS4 M1)

Planning migration metadata is additive and fail-closed:

- `planningPersistence.migrations.manifestCount`
- `planningPersistence.migrations.checksumBaseline`
- `planningPersistence.migrations.baselineEnforced`
- `planningPersistence.migrations.baselineMismatch`
- `planningPersistence.migrations.checksumValidation` with explicit outcome/reason and baseline markers

Enforcement behavior:

- checksum drift for an applied known migration version fails closed (`PLANNING_MIGRATION_CHECKSUM_DRIFT`)
- unexpected existing migration versions fail closed as baseline mismatch (`PLANNING_MIGRATION_BASELINE_MISMATCH`)
- optional expected baseline mismatch fails closed before mutation (`PLANNING_MIGRATION_BASELINE_MISMATCH`)

### Route Lock + Optimistic Concurrency Controls (WS4 M1)

Planning mutating routes (`POST /api/planning/records`, `POST /api/planning/merge`) apply practical lock and optimistic concurrency guards:

- route lock conflict fails closed with explicit deterministic envelope (`code = planning_route_lock_conflict`, `reason = lock_already_held`)
- optimistic concurrency uses expected version inputs (`expectedVersion`, `expectedRecordsVersion`, `x-planning-records-version`, or `If-Match`)
- version mismatch fails closed with explicit deterministic envelope (`code = optimistic_concurrency_conflict`, conflict reason markers)

### Compare Snapshot / Version Pinning

Compare responses pin request-start snapshots and expose:

```json
{
  "versionVector": {
    "pinned": {
      "planningRecordsVersion": 12,
      "implementedOutcomesVersion": "sha256..."
    },
    "current": {
      "planningRecordsVersion": 13,
      "implementedOutcomesVersion": "sha256..."
    }
  },
  "newerDataAvailable": true
}
```

`newerDataAvailable=true` indicates source or planning-record updates occurred after snapshot capture.

Compare responses also include a server-issued receipt used by merge flows:

```json
{
  "compareReceipt": {
    "receiptId": "compare-...",
    "compareHash": "h...",
    "sourceIdsHash": "h...",
    "gateState": "pass|degraded|insufficient-data|auth-denied",
    "mergeEligible": true,
    "issuedAt": "...",
    "expiresAt": "..."
  }
}
```

### Implemented-Outcomes Ingestion Trust Boundaries

Implemented-outcome ingestion is explicit and fail-closed:

- source type must be allowlisted (`plan-md`, `final-md`, `plans-index`)
- relative paths only; traversal escapes are denied (`path_traversal_denied`)
- schema validation failures are explicit (`status=invalid`)
- missing/unreadable sources are explicit (`status=unavailable`)
- stale but readable sources are explicit (`status=stale`)
- requested sources are always represented in response markers (no silent omission)

Source marker shape:

```json
{
  "sourceId": "session-plan",
  "sourceType": "plan-md",
  "path": "session-state/<id>/plan.md",
  "status": "available|stale|unavailable|invalid",
  "reason": "source_available",
  "stale": false,
  "ingestedCount": 1,
  "updatedAt": "2026-02-26T00:00:00.000Z"
}
```

### Deterministic Ordering

- planning-record precedence and tie-breaking use `planState.comparePlanningRecords`
- compare/search semantic ranking and tie-breaking use `planningSemantic.sortPlanningCandidates`

## Progress Tracker Structure (v1)

The Progress Tracker section must contain these subsections for structured parsing:

### Required Sections

#### 1. Work Unit Groups Overview
Markdown table with columns:
- `Group` — Group ID (e.g., `G-01`)
- `Title` — Human-readable group name
- `Status` — One of: `not-started`, `in-progress`, `done`, `blocked`, `skipped`
- `WUs Done` — Count of completed work units
- `WUs Total` — Total work units in group
- `Depends On` — Dependency list (e.g., `G-02,G-03`) or `—`

#### 2. Work Unit Status Table
Markdown table with columns:
- `Group` — Group ID
- `Work Unit ID` — WU identifier (e.g., `WU-003`)
- `Status` — One of: `not-started`, `in-progress`, `done`, `blocked`, `skipped`
- `Next Unit` — ID of next WU in sequence, or `—`
- `Notes` — Brief context or checkpoint results

#### 3. Next Unit
Single line identifying the next work unit to execute:
```markdown
**WU-003** — Foundation work must complete before UI changes
```
Or, if complete:
```markdown
NONE — all work units complete
```

#### 4. Checkpoints
Markdown table with columns:
- `Group` — Group ID
- `Checkpoint` — Checkpoint name (e.g., `unit-tests`, `manual-review`, `doc-update`)
- `Trigger` — When to run (e.g., `After G-01`, `Before finalization`)
- `Notes` — Checkpoint state + results

#### 5. Stream Evidence
Markdown table with columns:
- `Group` — Required stream ID token derived from `Work Unit Groups Overview` (normalized `G-NN` token)
- `Predicate` — Predicate contract used for this stream (`execution-log and/or stream-marker`)
- `Evidence` — Required pointer to artifact/log line/checkpoint entry when status is passed
- `Status` — `pending`, `passed`, or `failed`
- `Notes` — Free-form details; if used for machine-readable marker, include `status: passed|failed|pending`

Required rows:
- one row per normalized stream token present in `Work Unit Groups Overview`

#### 6. Final Gate Controls
Markdown table with columns:
- `Control`
- `Status`
- `Waiver Scope`
- `Waiver Release`
- `Waiver Audit`

Required control rows:
- `evidencePredicates`
- `finalGateWaiverPrecedence`
- `trustedEvidenceBindingRetention`

#### 7. Trusted Evidence Binding
Markdown table with columns:
- `Commit SHA`
- `Release Tag`
- `Channel`
- `Producer Identity`
- `Attestation Status`
- `Evidence Timestamp`
- `Evidence` (optional but recommended)

When `trustedEvidenceBindingRetention` has `Status=passed`, validator requires all fields above except `Evidence` to be non-empty.

#### 8. Evidence Retention
Markdown table with columns:
- `Policy`
- `Retention Days`
- `Retained`
- `Release Tag`
- `Evidence`

Required policy rows:
- `opsLogs`
- `perReleaseEvidence`

#### 9. Execution Log
Append-only text capturing key execution events:
```markdown
## Execution Log

2026-02-23T10:15:00Z — WU-001 started
2026-02-23T10:22:00Z — WU-001 completed (validation: pass)
2026-02-23T10:30:00Z — Checkpoint: unit-tests (status: passed; duration=18s)
```

### Checkpoint Result Encoding

To avoid schema changes, encode checkpoint state in the `Notes` cell using:
- `status: passed` — Checkpoint completed successfully
- `status: failed` — Checkpoint failed; see execution log
- `status: pending` — Checkpoint not yet run
- `status: skipped` — Checkpoint skipped (user declined or not applicable)

Example checkpoint notes:
```
status: passed; unit-test-runner; duration=42s
status: failed; integration-tests; see: execution log 2026-02-23T14:45
status: skipped; user declined doc update
```

### Required Stream Predicate Contract

For versioned planpacks (`<!-- IE_PLAN_PACK_VERSION: 1 -->`), `scripts/validate-planpack.js` derives required streams from the `## Work Unit Groups Overview` table.

Normalization rule:
- each `Group` cell is normalized to `G-NN` token (for example `G-06-release-readiness` → `G-06`)

A stream is considered satisfied only when **both** conditions are met:
1. `## Execution Log` contains an entry that references the stream ID and a completion token (`completed`, `done`, or `status: passed`), **and**
2. `## Stream Evidence` contains a row for that stream with `Status = passed` (or `Notes` containing `status: passed`) **and** non-empty `Evidence`.

If any derived required stream lacks either proof, validation fails deterministically with a non-zero exit code.

Examples:

```markdown
## Stream Evidence
| Group | Predicate | Evidence | Status | Notes |
| --- | --- | --- | --- | --- |
| G-01 | execution-log and/or stream-marker | execution-log:2026-02-25T14:55Z | passed | status: passed |
| G-02 | execution-log and/or stream-marker | checkpoint:cp-g02-tests | passed | status: passed |
| G-03 | execution-log and/or stream-marker | execution-log:2026-02-25T15:21Z | passed | status: passed |
| G-04 | execution-log and/or stream-marker | execution-log:2026-02-25T16:49Z | passed | status: passed |

## Execution Log
2026-02-25T14:55:11Z — G-01 completed (status: passed)
2026-02-25T15:21:29Z — G-03 completed (status: passed)
```

Compatibility behavior:
- If `IE_PLAN_PACK_VERSION` marker is missing, validator fails closed unless explicit legacy override (`--allow-legacy-best-effort`) is supplied.
- If marker version is unsupported (`!= 1`), validator fails closed.
- Version `1` enforces stream evidence predicates and final gate contracts.

### Trusted Evidence Binding + Retention Contract (G-05-WU-06)

For versioned planpacks where `trustedEvidenceBindingRetention` is marked `passed`, `scripts/validate-planpack.js` enforces trusted evidence and retention checks before final gate success:

1. `## Trusted Evidence Binding` must include a parseable row with:
  - Commit SHA
  - Release Tag
  - Channel
  - Producer Identity
  - Attestation Status (`true/yes/passed/attested` only)
  - Evidence Timestamp (ISO-8601)
2. Missing fields, attestation=false, or malformed timestamp fail deterministically.
3. Replay/staleness protection:
  - evidence is stale when age exceeds `--max-evidence-age-hours` (default `168h`).
4. Deterministic CI binding checks can pass expected values via:
  - `--expected-commit <SHA>`
  - `--expected-release <TAG>`
  - `--expected-channel <CHANNEL>`
  - optional deterministic time pinning with `--now <ISO_TIMESTAMP>`
5. `## Evidence Retention` must include parseable rows for:
  - `opsLogs`: `Retention Days >= 30`, `Retained=true`, and non-empty `Evidence`
  - `perReleaseEvidence`: `Retained=true`, non-empty `Release Tag`, and non-empty `Evidence`
6. Any missing/mismatch/stale/retention failure yields:
  - `final gate control failed: trustedEvidenceBindingRetention (...)`
  - non-zero validator exit code.

### Format Version Marker

Add this HTML comment at the top of the Progress Tracker section to make parsing/versioning explicit:

```html
<!-- IE_PROGRESS_TRACKER_VERSION: 1 -->
```

Parser behavior:
- **Marker missing**: Parse as best-effort "v0" (legacy format)
- **Marker present but unknown version**: Return structured response with warnings

## Planning Lifecycle and Conflict Ordering Contract

Planning lifecycle state machine for planning records:
- States: `thought`, `research`, `pre-plan`, `queued`, `implemented`, `merged`, `superseded`
- Terminal states: `merged`, `superseded`
- Forward transitions: `thought -> research -> pre-plan -> queued -> implemented -> merged`
- Branch transitions to terminal: any non-terminal state may transition to `merged` or `superseded`
- Invalid transitions: self-transitions and any transition out of terminal states

Deterministic same-item conflict ordering is applied in this exact sequence:
1. Scope precedence: `user` > `repo` > `global`
2. `score` descending, where `null`/invalid/`NaN` scores are treated as `-1`
3. `updatedAt` descending, where missing/invalid timestamps are treated as Unix epoch (`1970-01-01T00:00:00Z`)
4. `createdAt` descending, with the same null handling as `updatedAt`
5. `recordId` ascending as final deterministic tie-breaker

Planning visibility and authorization defaults:
- Default-deny: missing or invalid identity context denies read/write/compare.
- Actor identity is server-derived from the authenticated principal; client-provided `userId` is not trusted for authorization decisions.
- `repo` scope requires both owner match and repository context match.
- `global` and `user` scopes require owner match.
- Compare requests must provide explicit requested scopes; unauthorized scopes are denied and surfaced via `deniedScopes` markers.

Planning merge safety invariants:
- Merge execution requires a confirmation token with `tokenId`, `actorId`, `sourceIdsHash`, `targetId`, `compareHash`, `issuedAt`, and `expiresAt`.
- Confirmation token TTL is capped (15 minutes) and consumed tokens are invalid.
- Merge requests require an idempotency key; same key + same payload is replay-safe, same key + different payload is a conflict.
- Atomic envelope contract requires all components to commit or abort together: `targetUpdate`, `sourceTransitions`, `lineageLinks`, `auditEvent`, and `tokenConsumedWrite`.

### WS3 Authority Dependency Gate for Planning Durability (G-05-WU-01)

Planning durability routes require WS3 authority/reconciliation contract readiness before execution.

Dependency gate contract:

- `dependency = ws3_authority_reconciliation_contract`
- gate is deterministic and fail-closed (`required=true`, `deterministic=true`)
- readiness requires WS3 contract invariants to be satisfied:
  - reconciliation contract metadata is present
  - canonical authority/source mappings remain valid (`acp`, `acp-only`, `fs` with runtime > artifact precedence)
  - planning scope precedence remains deterministic (`user > repo > global`)

Durability route scope:

- `POST /api/planning/records`
- `GET /api/planning/records`
- `GET /api/planning/search`
- `POST /api/planning/compare`
- `POST /api/planning/merge-intent`
- `POST /api/planning/merge`

When readiness is not satisfied, routes fail closed with explicit marker envelope:

```json
{
  "contractVersion": "planning_api_v1",
  "kind": "planning.create|planning.list|planning.search|planning.compare|planning.merge-intent|planning.merge",
  "deterministic": true,
  "error": "Planning durability dependency gate blocked",
  "code": "planning_durability_dependency_gate_blocked",
  "reason": "<deterministic-primary-reason>",
  "dependencyGate": {
    "marker": "dependency-blocked",
    "dependency": "ws3_authority_reconciliation_contract",
    "required": true,
    "ready": false,
    "contractVersion": "1",
    "reasonCodes": ["..."],
    "ws3": { "...": "diagnostic-contract-state" }
  }
}
```

Non-durability paths remain backward compatible and are not blocked by this gate.

### WS5A M1 Durability-Critical Route Gate (WU-WS5A-M1-01)

Durability-critical merge lifecycle routes must fail closed unless persistence authority is ready and WS5A durability migrations are present.

Durability-critical route scope:

- `POST /api/planning/compare`
- `POST /api/planning/merge-intent`
- `POST /api/planning/merge`
- `POST /api/planning/suggestions`
- `GET /api/planning/suggestions?suggestionId=<id>`
- `POST /api/planning/recaps`
- `GET /api/planning/recaps?recapId=<id>`

Required additive migration versions:

- `004_planning_compare_receipts_init`
- `005_planning_merge_intents_init`
- `006_planning_merge_idempotency_ledger_init`
- `007_planning_suggestions_init`
- `008_planning_recaps_init`

When not ready, routes fail closed with explicit deterministic envelope:

```json
{
  "contractVersion": "planning_api_v1",
  "kind": "planning.compare|planning.merge-intent|planning.merge|planning.suggestion.persist|planning.suggestion.read|planning.recap.persist|planning.recap.read",
  "deterministic": true,
  "error": "Planning durability route gate blocked",
  "code": "planning_durability_route_gate_blocked",
  "reason": "planning_persistence_not_configured|planning_persistence_not_ready|planning_durability_artifact_migrations_missing",
  "durabilityRouteGate": {
    "marker": "dependency-blocked",
    "dependency": "ws5a_durability_persistence_gate",
    "required": true,
    "ready": false,
    "contractVersion": "1",
    "reasonCodes": ["..."],
    "migrationVersions": ["..."],
    "checkedMigrationVersions": ["..."],
    "missingMigrationVersions": ["..."],
    "persistenceAuthority": {
      "persistedAuthority": false,
      "ready": false,
      "status": "disabled|configured_no_client|ready",
      "lastError": "..."
    }
  }
}
```

### WS5A M3 Durable Suggestions + Recaps Contract (WU-WS5A-M3-01 / WU-WS5A-M3-02)

Suggestions and recaps use persisted DB authority as canonical storage. Contracts are additive, deterministic, and fail closed when persistence authority is unavailable.

Suggestions:

- `POST /api/planning/suggestions`
  - body contract: `{ suggestionId, scope?, state, createdAt?, updatedAt? }`
  - response contract: `{ contractVersion, kind="planning.suggestion.persist", deterministic=true, suggestion }`
- `GET /api/planning/suggestions?suggestionId=<id>`
  - response contract: `{ contractVersion, kind="planning.suggestion.read", deterministic=true, suggestion }`

Recaps:

- `POST /api/planning/recaps`
  - body contract: `{ recapId, scope?, state, createdAt?, updatedAt? }`
  - response contract: `{ contractVersion, kind="planning.recap.persist", deterministic=true, recap }`
- `GET /api/planning/recaps?recapId=<id>`
  - response contract: `{ contractVersion, kind="planning.recap.read", deterministic=true, recap }`

Deterministic retrieval/error semantics:

- missing id parameter returns `400`
  - suggestions: `error.code=invalid_planning_suggestion`, `error.reason=missing_suggestion_id`
  - recaps: `error.code=invalid_planning_recap`, `error.reason=missing_recap_id`
- missing persisted artifact returns `404`
  - suggestions: `planning_suggestion_not_found`
  - recaps: `planning_recap_not_found`
- scope/ownership denial returns `403` with `error.code=scope_visibility_denied`
- persistence authority/dependency gate failures remain fail-closed with existing deterministic gate envelopes (`planning_durability_dependency_gate_blocked` / `planning_durability_route_gate_blocked`)

Durability + restart safety expectations:

- persisted suggestion/recap artifacts are restart-safe DB records
- retrieval behavior does not depend on in-memory process state
- no fallback to file-based persistence for suggestions/recaps

## Planning UI Contract (WS5)

The Planning tab in `copilot-ui` maps compare/list/search/create contracts into a deterministic merge UX surface.

### Gate State Enum

Planning gate state is normalized to exactly one of:

- `pass`
- `degraded`
- `insufficient-data`
- `policy-blocked`
- `auth-denied`

State precedence is deny-dominant: policy/auth denial resolves before degraded/pass.

### Merge Enablement Predicate

UI and handler guard share one predicate:

- `isMergeEnabled(gateState) === true` only when `gateState === pass`
- all non-pass states hard-disable merge controls and handler returns before any network request is emitted

### Precedence Conflict Review

Compare-driven conflict rows are deterministic and explicit:

- precedence winner ordering: `user > repo > global`
- tie-break inside same scope: `updatedAt desc`, then `createdAt desc`, then `recordId asc`
- merge confirmation requires explicit review acknowledgment on each conflict row before confirm is enabled

### Intent-Bound Confirmation Semantics

WS5 confirmation token handling mirrors backend contract patterns:

- server issues intent tokens via `POST /api/planning/merge-intent`
- server consumes and validates tokens via `POST /api/planning/merge`
- token bound to actor + target + sourceIds hash + compare snapshot hash + pinned version vector
- intent issuance requires a valid server compare receipt id (`compareReceiptId`) and `mergeEligible=true`
- short TTL by default (5m) with max cap (15m)
- rejection reasons include mismatch (`actor_mismatch`, `target_mismatch`, `compare_hash_mismatch`, `source_ids_hash_mismatch`, `snapshot_version_mismatch`), expiry (`token_expired`), and replay/single-use (`token_consumed`)
- merge idempotency is enforced server-side (`same key + same payload => replay`, `same key + different payload => conflict`)
- server recomputes canonical `sourceIdsHash` from request `sourceIds` and rejects mismatch before commit

### Compare Visibility Markers

WS5 surfaces compare response visibility markers without silent omission:

- `deniedScopes` are rendered directly in Planning UI
- implemented outcome source markers (`available|stale|unavailable|invalid` + reason/path) are rendered directly in Planning UI
- default-deny behavior is represented as `auth-denied` in the gate-state mapping

## Legacy Session Migration

**Legacy `.instructions/sessions/` is deprecated.**

Old sessions remain where they are by default. If you want a legacy session visible to copilot-ui:

1. Locate the session folder under `.instructions/sessions/<SESSION_ID>/`
2. Copy it to `~/.copilot/session-state/<SESSION_ID>/`
3. Restart the dashboard

The dashboard will now show the migrated session.
