---
created: 2026-06-18
updated: 2026-06-18
category: system
status: current
doc_kind: node
id: orchestrator-architecture-adr
summary: Architecture decision record for the durable Harness Execution Orchestrator — a Rust-owned control plane for isolated worker dispatch, planning lease binding, worktree verification, and safe human approval.
tags: [architecture, adr, orchestrator, execution]
related: [domain-authorities-freeze, planning-backlog-roadmap-contract, runtime-permissions-contracts, security-model]
---

# Harness Execution Orchestrator Architecture ADR

## Context

The Elegy Copilot currently has no durable execution orchestrator. Work is dispatched ad-hoc by OpenCode/Codex sessions with no central lease, evidence chain, or verified repository state.

`elegy-planning` owns durable planning state (goals, roadmaps, plans, work points, leases, review points). The orchestrator must consume that authority, not duplicate it.

The existing Rust native runtime (port 3211, Axum) is an optional sidecar with stubbed capabilities (`planning_persistence=disabled`, `autonomous_decision_log=not_ported`). The orchestrator extends this runtime with new modules.

The existing workspace Execution tab (`copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx`) is a placeholder showing a `WorkspaceCommandsCard` and a "Terminal — future release" div. The orchestrator must replace it with a real operator control surface.

The existing shared worktree contract and worktree registry already exist at `~/.elegy/repo-state/<repoId>/worktrees/`.

## Resolved: ~/.copilot/ vs ~/.elegy/ path conflict

The `domain-authorities-freeze.md` (2026-04-07) declares `~/.elegy` as the canonical runtime state root. However, `planning-backlog-roadmap-contract.md` (updated 2026-05-18, AFTER the freeze) still references `~/.copilot/` for session artifacts (`~/.copilot/session-state/<SESSION_ID>/plan.md`) and task-board storage (`~/.copilot/repo-state/<repoId>/tasks/`). This is upstream drift in the planning contract that a separate migration work-point (not in scope for the orchestrator v1) will reconcile.

Resolution rule for the orchestrator:
- The orchestrator writes execution state exclusively under `~/.elegy/orchestrator/`.
- The Rust config reads the canonical `elegy_home` and does not reference `~/.copilot/` paths.
- The Node proxy bridge (`copilot-ui/server.js`) must resolve session artifacts from the path defined by its own runtime config, which currently uses `~/.copilot/`. The bridge is responsible for path normalization when reading artifacts and forwarding them to the orchestrator API.
- If the `elegy_home` and `copilot_home` roots differ at runtime, the orchestrator health endpoint MUST report `path_divergence_detected` as a warning state rather than failing closed.

## Decision: Authority and State Ownership Matrix

Define these NEW orchestrator domains (extending the 7 domains already frozen in `domain-authorities-freeze.md`):

| Domain | Canonical authority | Canonical location | Legacy / secondary |
|---|---|---|---|
| Planning concurrency (Domain 8) | `elegy-planning` lease/fencing/heartbeat primitives | `elegy-planning` CLI via project-run claim/activate/release | Existing planning-tools skill callers remain compatible |
| Execution journal (Domain 9) | Rust orchestrator append-only event journal | `native/runtime/src/orchestrator/journal/` | Not a second planning authority; references planning entities |
| Worktree isolation & repo verification (Domain 10) | Shared worktree contract consumed by orchestrator | Existing `~/.elegy/repo-state/<repoId>/worktrees/` registry | Orchestrator derives actual Git diff; no new worktree schema |
| Approval binding (Domain 11) | Rust orchestrator single-use approval tokens | `native/runtime/src/orchestrator/approval/` | Push and PR creation unavailable in v1 |
| Execution workspace UI (Domain 12) | Existing workspace Execution tab | `copilot-ui/ui/src/views/Workspace/WorkspaceExecutionTab.tsx` | Planning graph content linked, not duplicated |
| Worker adapter registry (Domain 13) | Capability-negotiated adapter registry in Rust runtime | `native/runtime/src/orchestrator/worker/` | Workers are untrusted producers |

Rules:
1. `elegy-planning` is the sole authority for planning state. The orchestrator never creates goals, roadmaps, or work points.
2. The Rust execution journal is append-only. Projections are derived, not independent stores.
3. Approvals are single-use, cryptographically bound to immutable Git state. Binding contract: hash algorithm SHA-256; binding format `HMAC-SHA256(orchestrator_secret, canonical_json(base_head_sha, result_tree_sha, diff_blake3_hash, target_head_sha, expiry_unix_ms, idempotency_key))`; idempotency key derived as UUIDv7 from `SHA-256(concat(goal_id, work_point_id, run_id, base_head_sha))`; payload identity determined by byte-equal canonical JSON of bound fields.
4. Worker-reported patches and validation claims are never accepted without independent orchestrator verification.
5. The existing Execution tab is the sole UI owner. No second tab is introduced.

## Decision: Runtime Topology

The additive topology (no replacement of existing components):

```
Desktop Shell (Tauri + WebView, existing)
    │ HTTP 127.0.0.1
    ▼
Node.js HTTP Server (copilot-ui/server.js, existing, primary)
    │
    ├──► Rust Sidecar (port 3211, existing + new orchestrator modules)
    │    ├── orchestrator/journal/     (NEW: append-only event journal)
    │    ├── orchestrator/lease/       (NEW: planning lease client)
    │    ├── orchestrator/worktree/    (NEW: worktree isolation + diff verification)
    │    ├── orchestrator/validation/  (NEW: authoritative repo checks)
    │    ├── orchestrator/approval/    (NEW: state-bound approval tokens)
    │    ├── orchestrator/worker/      (NEW: adapter registry + process supervision)
    │    └── orchestrator/api/         (NEW: idempotent HTTP + SSE endpoints)
    │
    ├──► elegy-planning CLI (existing, planning authority)
    │    Lease claim, heartbeat, fencing, release
    │
    └──► local-tracker (existing, gateway)
         Messaging gateway, task watching
```

State:
- `~/.elegy/planning.db` — planning authority (existing, `elegy-planning`)
- `~/.elegy/repo-state/<repoId>/worktrees/` — shared worktree registry (existing)
- `~/.elegy/orchestrator/` — execution journal + projections (NEW, Rust-owned)
- Worktree filesystems — isolated Git state (existing contract)

## Decision: Worker Trust Model

Workers (OpenCode, Codex, and native adapters) are untrusted producers:
- Workers may produce malformed output, claim false validation success, modify out-of-scope files, or fail silently.
- The orchestrator is the sole verifier of actual repository state after worker completion.
- Evidence claims from workers are recorded but not trusted until orchestrator verification.
- Workers execute with planning CLI access scoped to the claimed lease only. The orchestrator MUST issue single-use lease tokens to workers that the `elegy-planning` CLI verifies before allowing mutation. The CLI MUST reject lease mutations for work points not matching the issued token. (Tracked as ORCH-005a: CLI auth scoping for leased work points.)

## Decision: Threat Model

Threats the orchestrator must defend against:

1. **Stale lease owner mutation** — An expired lease holder attempts to mutate state after a new owner claims the work point. Defense: monotonically increasing fencing tokens validated on every mutation.

2. **Replayed approvals** — A captured approval token is replayed. Defense: single-use idempotency keys bound to immutable Git state (base HEAD, tree SHA, diff hash, target HEAD, expiry).

3. **Worker compromise** — A worker process modifies out-of-scope files or claims false validation. Defense: orchestrator derives actual diff from Git, checks file scope against work point definition, runs authoritative validation independently.

4. **Dirty/foreign worktrees** — A worktree has pre-existing changes from another session. Defense: fail-closed on dirty or foreign worktrees; record actionable state.

5. **Target-branch drift** — The target branch moves between approval issuance and merge. Defense: approval binds target HEAD; stale detection before commit/merge.

6. **Process escape / orphan** — Worker processes survive cancellation or timeout. Defense: process-tree supervision with termination on timeout/cancellation.

7. **Duplicate dispatch** — Same work point dispatched twice concurrently. Defense: atomic lease claim with compare-and-claim semantics (requires `elegy-planning` support).

8. **Crash recovery** — Orchestrator crashes mid-execution. Defense: append-only journal with deterministic replay; restart at every state boundary resumes without duplicate side effects.

## Decision: Execution State Machine

Canonical states for a work-point execution run:

```
Claimed → Dispatched → Running → Completed | Failed | Cancelled
                                    ↓
                              Verifying → Verified | VerificationFailed
                                    ↓
                              AwaitingApproval → Approved | Rejected
                                    ↓
                              Committing → Committed | CommitFailed
                                    ↓
                              Merging → Merged | MergeConflict
```

Recovery classes:
- **Restartable**: Claimed, Dispatched, Running, Verifying — can restart from Claimed
- **Replayable**: Completed, Verified, AwaitingApproval — replay journal from last durable event
- **Terminal**: Committed, Merged, Failed, Cancelled — no automatic restart

Verifying is restartable (not replayable) because verification steps may involve external commands (e.g., `npm test`) whose idempotency cannot be guaranteed across replays. Verification steps MUST be idempotent with respect to the same worktree state: re-running verification against the same base HEAD and result tree MUST produce the same pass/fail outcome. Non-deterministic verifiers (e.g., flaky test suites) MUST be wrapped in a deterministic gate with bounded retry.

## Decision: Non-Goals for v1

- No push or pull-request creation
- No permanent warm worker processes (cold process + resumable logical session)
- No automatic merge (requires explicit approval)
- No second Execution tab, native daemon, planning authority, or worktree schema
- No multi-repository concurrent runs (one active run per repository). Rationale: the append-only journal serializes per-repository because worktree isolation uses the repo's shared worktree registry and the journal's ordering guarantees require single-writer semantics per repo. Per-worktree journal partitions are a v2 scope item.
- No Claude Code adapter in v1. The protocol spike was cancelled after account-level
  HTTP 402 failures prevented conformance evidence.

## Lease dependency fallback

The entire orchestrator depends on `elegy-planning` lease/fencing/heartbeat primitives (compare-and-claim atomicity, fencing token monotonicity, heartbeat expiry). These primitives are targeted by ORCH-005 but may not be available at orchestrator build time.

Fallback rule:
- If `elegy-planning` lease primitives are not yet available, the orchestrator MUST default-off with a deterministic `planning_lease_unavailable` health status.
- No partial lease implementation is acceptable.
- A provisional file-lock fallback using `~/.elegy/orchestrator/locks/<work_point_id>.lock` with PID plus monotonic timestamp lease records is the provisional path, but it lacks fencing monotonicity and MUST produce a `degraded_lease_mode` health warning.
- The orchestrator MUST reject all dispatch requests deterministically (with error code `lease_unavailable`) while in `degraded_lease_mode` — it must not silently accept work without fencing protection.

## Consequences

Positive:
- Atomic lease/fencing prevents duplicate ownership
- Append-only journal enables crash recovery
- Single-use approvals bound to immutable Git state prevent replay
- Independent verification prevents worker spoofing
- Existing topology preserved (purely additive)

Negative:
- Requires `elegy-planning` lease/fencing primitives (external dependency, ORCH-005)
- Cold process startup adds latency per dispatch
- One-run-per-repo limits throughput

Migration:
- Existing OpenCode lanes and workspace tabs continue unchanged
- Experimental flag defaults off
- Pilot with one repository and one proven adapter before expansion
- The canonical wire contracts are defined in
  `docs/system/orchestrator-contracts.md`.

## Validation notes

- This ADR is designed to be checked by the doc validator (frontmatter + structure).
- The companion spec is `docs/specs/project-lane-orchestrator/spec.md`.
- Future work units implement the orchestrator modules, lease client, journal, worker adapter registry, approval tokens, and UI replacement described here.
