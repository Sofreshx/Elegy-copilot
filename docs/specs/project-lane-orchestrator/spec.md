---
spec_id: project-lane-orchestrator
title: Harness-Agnostic Durable Execution Orchestrator
status: draft
type: feature
updated: 2026-06-18
related:
  - orchestrator-architecture-adr
---

# Harness-Agnostic Durable Execution Orchestrator

## Intent

Build a Rust-owned durable execution control plane that dispatches isolated coding workers through OpenCode, Codex, and deterministic native adapters; binds execution to `elegy-planning` work points; verifies actual repository state; and exposes safe human approval controls in the existing workspace Execution tab.

## Context Evidence

**Architecture & domain boundaries:**
- `docs/system/architecture-overview.md` — three-layer topology (Tauri → Node → ~/.elegy/)
- `docs/system/domain-authorities-freeze.md` — 7 frozen domain authorities (Domains 1–7). This spec extends to Domains 8–13.
- `docs/system/orchestrator-architecture-adr.md` — companion ADR: authority matrix, topology, threat model, execution state machine, non-goals

**Planning & runtime contracts:**
- `docs/system/planning-backlog-roadmap-contract.md` — planning entity hierarchy: Goal → Roadmap → Work point → Plan → Todo
- `docs/system/security-model.md` — desktop distribution trust chain, kill-switch rules
- `docs/system/runtime-permissions-contracts.md` — runtime contract v1.0.0, fail-closed semantics

> **Context note (2026-06-22):** The Rust native runtime referenced below was removed from the codebase.
> The orchestrator would need a new backend if re-implemented.

**Existing runtime:**
- `copilot-ui/server.js` — Node.js HTTP server, primary request router

**Node proxy & UI:**
- `copilot-ui/server.js` — Node.js HTTP server, primary request router, planning persistence import surface
- `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx` — existing Execution tab placeholder (21 lines): renders `WorkspaceCommandsCard` + "Terminal — future release" div
- `copilot-ui/ui/src/views/Workspace/` — workspace views including `copilot-ui/ui/src/views/Workspace/WorkspaceGitTab.tsx`, `copilot-ui/ui/src/views/Workspace/WorkspacePlanningTab.tsx`, `copilot-ui/ui/src/views/Workspace/WorkspaceReviewTab.tsx`, `copilot-ui/ui/src/views/Workspace/WorkspaceDocsTab.tsx`, etc.

**Existing state stores:**
- ~/.elegy/repo-state/<repoId>/worktrees/ — shared worktree registry (file-based, lifecycle recorded in both filesystem and SQLite `hook_events` table)
- ~/.elegy/planning.db — planning authority SQLite database (elegy-planning CLI)
- ~/.elegy/orchestrator/ — execution journal destination (NEW, Rust-owned, not yet created)

**Worktree contract:**
- docs/lexicon/project-specific.md:241 — worktree lifecycle definition: allocation, activation, completion, interruption, removal. Transitions recorded in shared file registry and `hook_events` table.

**Spec governance:**
- `scripts/validate-specs.js` (867 lines) — spec structural + strict-mode validator

## Requirements

### Allowed Behavior

- Atomic planning leases with compare-and-claim, fencing tokens, heartbeat, and expiry
- Append-only execution event journal under ~/.elegy/orchestrator/ with guarded state transitions
- Worktree isolation through existing shared worktree contract with scope violation detection
- Orchestrator-observed authoritative validation independent of worker claims
- Single-use approval tokens cryptographically bound to immutable Git state
- Worker adapter conformance with dispatch, cancellation, timeout, and resume fixtures
- Idempotent HTTP endpoints with idempotency keys and SSE replay with `Last-Event-ID`
- Replacing the existing workspace Execution tab placeholder with full session, evidence, and approval controls
- Adversarial recovery validation suite covering lease expiry, crashes, malformed output, and stale approvals
- Experimental pilot defaulting off behind `RuntimeConfig` flag with telemetry

### Forbidden Behavior

- Push or pull-request creation (approval-bound only)
- Permanent warm worker processes (cold process plus resumable session is the default)
- Automatic merge without human approval
- Multi-repository concurrent runs in v1 (one active run per repo)
- Claude Code adapter in v1 (protocol spike cancelled)
- Second Execution tab, native daemon, planning authority, or worktree schema
- Duplicate dispatch, duplicate commit, duplicate merge, or stale-owner mutation

### R1 — Atomic planning leases and fencing

The orchestrator MUST claim work points through `elegy-planning`'s lease primitives (compare-and-claim, fencing token, heartbeat, expiry).

- Expired owners MUST NOT mutate after a new fencing token is issued.
- Two concurrent claimers MUST NOT own the same work point.
- Lease failures MUST produce deterministic error contracts suitable for UI display.
- → verify: `elegy-planning` lease race tests pass (ORCH-005).

### R2 — Durable execution journal

The Rust orchestrator MUST maintain an append-only execution event journal under ~/.elegy/orchestrator/.

- State transitions MUST be guarded (illegal transitions fail closed).
- Replaying the same event history MUST produce byte-equivalent normalized projections.
- Restart at every state boundary MUST resume without duplicate dispatch or side effects.
- Journal records MUST reference planning entities by ID but never duplicate planning state.
- → verify: Rust journal replay tests pass (ORCH-008).

### R3 — Worktree isolation and actual diff verification

The orchestrator MUST allocate or attach isolated worktrees through the existing shared worktree contract at `~/.elegy/repo-state/<repoId>/worktrees/`.

- Dirty or foreign worktrees MUST fail closed with actionable state (which paths, expected state).
- No new worktree file schema or filename family MUST be introduced.
- Out-of-scope modifications MUST block progression and list actual changed paths.
- Result evidence MUST record base HEAD, resulting tree SHA, and canonical diff hash.
- → verify: Worktree isolation tests with scope violations fail closed (ORCH-009).

### R4 — Authoritative validation

After worker execution, the orchestrator MUST run the narrowest repository-defined checks independently.

- Worker evidence claims MUST be separated from orchestrator-observed results.
- No-check configuration MUST yield an explicit neutral result, not false success.
- Worker claims MUST NOT satisfy a gate without orchestrator-observed evidence.
- Validation output follows the existing contract: deterministic, fail-closed, machine-readable.
- → verify: Validation gate tests with spoofed worker claims fail (ORCH-010).

### R5 — State-bound commit and merge approvals

Approvals MUST be single-use tokens bound to immutable Git state. Binding contract: hash algorithm SHA-256; binding format `HMAC-SHA256(orchestrator_secret, canonical_json(base_head_sha, result_tree_sha, diff_blake3_hash, target_head_sha, expiry_unix_ms, idempotency_key))`; idempotency key derived as UUIDv7 from `SHA-256(concat(goal_id, work_point_id, run_id, base_head_sha))`; payload identity determined by byte-equal canonical JSON of bound fields.

- Duplicate idempotency keys with identical payload MUST replay safely; different payload MUST conflict.
- Target-branch drift after approval issuance MUST make the approval stale.
- Stale approvals MUST produce a clear UI warning with the delta.
- Push and pull-request creation MUST remain unavailable.
- → verify: Approval binding tests with stale state and replayed tokens (ORCH-011).

### R6 — Worker adapter conformance

Each v1 adapter (OpenCode ACP, Codex exec, native) MUST pass its applicable common dispatch, cancellation, timeout, malformed-output, and resume fixtures.

- Child process trees MUST be terminated on timeout and cancellation.
- Unavailable capabilities MUST be reported before dispatch.
- Cold process plus resumable logical session is the default; permanent warm processes not required for v1.
- Capacity reporting (available/max-concurrent/backpressure) MUST be exposed via health endpoint.
- → verify: Adapter conformance fixtures pass for all registered adapters (ORCH-012).

### R7 — Idempotent HTTP API and replayable SSE

All mutating endpoints MUST require idempotency keys and return deterministic stale/conflict errors.

- Health endpoint MUST expose planning compatibility, adapter availability, journal readiness, and orphan recovery.
- Node proxy MUST NOT buffer the event stream and MUST propagate client disconnect.
- SSE reconnect with `Last-Event-ID` MUST replay missing events in projection order.
- Endpoints added under a new backend orchestrator API module — existing routes remain unchanged.
- → verify: API contract tests with idempotency, SSE replay, and disconnect handling (ORCH-013).

### R8 — Existing Execution workspace UI

The existing placeholder (`copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx`, 21 lines) MUST be replaced with:

- Session creation (select work point, configure adapter)
- Worker selection (available adapters, capability summary)
- State timeline (execution state machine with transitions and timestamps)
- Work point display (linked planning entity with description, file scope, dependencies)
- Lease health indicator (owner, heartbeat age, fencing token, expiry)
- Input requests (waiting for human input prompts)
- Actual diff/evidence display (orchestrator-derived Git diff, validation results)
- Approval controls (approve/reject with diff summary, stale-state warning)
- Retry/resume/cancel actions (boundary-safe, idempotent)
- State warnings (stale lease, stale approval, disconnected, crash recovery)

Rules:
- No additional top-level or workspace Execution tab MUST be created.
- Planning graph content MUST be linked, not duplicated (via planning entity IDs, not inline state).
- Component tests MUST cover: normal, waiting-input, validation-failed, stale-approval, disconnected, and completed states.
- → verify: UI component tests and browser visual checks (ORCH-014).

### R9 — Adversarial recovery validation

Tests MUST exercise:

| Scenario | What it proves |
|---|---|
| Simultaneous claims | Atomic lease enforcement |
| Lease expiry | Fencing token monotonicity |
| Stale fencing tokens | Mutation rejection |
| Crashes at every transition | Idempotent restart recovery |
| Lost acknowledgements | Journal replay determinism |
| Malformed output | Adapter parse failure handling |
| Process-tree hangs | Timeout termination |
| Scope violations | Worktree isolation |
| Stale approvals | Target-branch drift detection |
| Merge conflicts | Clean failure + UI signal |
| SSE replay | Gap-free event delivery |
| Cancellation races | At-most-once termination |

- No test MUST produce duplicate dispatch, duplicate commit, duplicate merge, or stale-owner mutation.
- Existing OpenCode lanes and workspace tabs MUST pass regression validation.
- → verify: Full adversarial suite passes (ORCH-015).

### R10 — Bounded experimental pilot

- The orchestrator MUST default off behind an experimental flag in `RuntimeConfig`.
- Merge into default-on MUST NOT be enabled until stale-approval and crash-injection gates pass.
- Pilot MUST record:

| Metric | Purpose |
|---|---|
| Duplicate-dispatch attempts | Lease contention detection |
| Adapter parse failures | Worker output quality |
| Recovery failures | Journal replay correctness |
| Scope violations | Worktree isolation efficacy |
| Approval latency | Human-in-loop responsiveness |
| Cancellation outcomes | Clean vs orphan termination |

- Pilot telemetry MUST be append-only and crash-safe.
- → verify: Pilot telemetry records all required failure categories (ORCH-016).

## Non-Goals

- Push or pull-request creation
- Permanent warm worker processes
- Automatic merge without approval
- Multi-repository concurrent runs (v1 limit: one active run per repo). Rationale: the append-only journal serializes per-repository because worktree isolation uses the repo's shared worktree registry and the journal's ordering guarantees require single-writer semantics per repo. Per-worktree journal partitions are a v2 scope item.
- Claude Code adapter. Its protocol spike was cancelled after account-level HTTP 402 failures prevented conformance evidence.
- Second Execution tab, native daemon, planning authority, or worktree schema

## Acceptance Checks

- Atomic leases, fencing tokens, heartbeats, idempotency keys, and restart recovery prevent duplicate ownership and stale side effects.
  → verify: Adversarial suite (ORCH-015) — no duplicate dispatch, commit, merge, or stale-owner mutation

- Commit and merge approvals are single-use and cryptographically bound to immutable repository state.
  → verify: Approval binding tests (ORCH-011) — stale state, replayed tokens, drifted target HEAD all rejected

- Existing OpenCode lanes and current Node/Rust runtime topology continue to operate without behavioral regression.
  → verify: Regression suite (ORCH-015) — all existing workspace tab tests pass

- OpenCode and Codex integrations use supported machine protocols or non-interactive CLI surfaces rather than invented flags.
  → verify: Adapter conformance fixtures (ORCH-012) — common dispatch/cancel/timeout/resume across all adapters

- The existing workspace Execution tab provides session state, evidence, input requests, approvals, cancellation, and recovery controls.
  → verify: UI component tests (ORCH-014) — normal, waiting-input, validation-failed, stale-approval, disconnected, completed states

- Workers operate in isolated worktrees; the orchestrator derives the actual Git diff and runs authoritative repo-defined validation.
  → verify: Worktree isolation tests (ORCH-009), validation gate tests (ORCH-010)

- Spec validation passes.
  → verify: node scripts/validate-specs.js --strict docs/specs/project-lane-orchestrator/spec.md

- Full UI build succeeds after Execution tab changes.
  → verify: `npm --prefix copilot-ui run ui:build`

## Implementation Links

- `docs/system/orchestrator-architecture-adr.md` — companion ADR
- `docs/specs/project-lane-orchestrator/spec.md` (this file)
- Node.js backend (`copilot-ui/server.js`) — API server
- `copilot-ui/server.js` — Node.js HTTP server, primary proxy boundary
- `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx` — existing Execution tab placeholder
- `docs/system/architecture-overview.md` — current topology
- `docs/system/domain-authorities-freeze.md` — 7 frozen domain authorities
- `docs/system/planning-backlog-roadmap-contract.md` — planning entity hierarchy

## Validation Evidence

- Spec strict validation: node scripts/validate-specs.js --strict docs/specs/project-lane-orchestrator/spec.md pending (fixing headings)
- ADR frontmatter structure validated (9 fields, matches existing ADR convention)
- Spec frontmatter structure validated (6 fields: spec_id, title, status, type, updated, related)
- Cross-references to existing canonical docs verified (architecture-overview, domain-authorities-freeze, planning-backlog-roadmap-contract, security-model, runtime-permissions-contracts)
- Upcoming: adversarial review by rubberduck-plan-review (ORCH-001-T07)

## Drift Notes

- (none yet — initial draft)
