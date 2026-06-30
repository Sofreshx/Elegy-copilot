---
created: 2026-06-19
updated: 2026-06-30
category: system
status: current
doc_kind: node
id: orchestrator-pilot-rollout
summary: Bounded rollout contract and promotion gates for the Harness Execution Orchestrator.
tags: [orchestrator, pilot, rollout, telemetry]
related: [orchestrator-architecture-adr, orchestrator-contracts]
---

# Harness Execution Orchestrator Pilot

## Pilot contract

| Control | Pilot value |
|---|---|
| Enable flag | `ELEGY_ORCHESTRATOR_EXPERIMENTAL=1` |
| Default | Off |
| Repository concurrency | One active session per repository |
| Adapters | `native`, `codex-exec` |
| Approval action | Commit |
| Merge | Off unless both merge promotion gates pass |
| State root | `~/.elegy/orchestrator/pilot/` |

The runtime rejects dispatch with `pilot_disabled` while the flag is off. Other
runtime and workspace behavior is unchanged.

OpenCode remains outside the bounded pilot. Promote it only after its adapter
conformance suite passes against the shipped executable. Claude Code remains
excluded from v1 because no successful protocol evidence exists.

## Merge gate

Merge requires:

1. `ELEGY_ORCHESTRATOR_PILOT_MERGE=1`.
2. `~/.elegy/orchestrator/pilot/promotion-gates.json`:

```json
{
  "staleApprovalGatePassed": true,
  "crashInjectionGatePassed": true
}
```

Missing, malformed, or partial evidence keeps merge off.

## Telemetry

Append-only log:

```text
~/.elegy/orchestrator/pilot/events.jsonl
```

Required categories:

| Category | Producer |
|---|---|
| `duplicate-dispatch-attempt` | Session admission gate |
| `adapter-parse-failure` | Worker supervisor |
| `recovery-failure` | Journal recovery |
| `scope-violation` | Worktree verifier |
| `approval-latency` | Approval API |
| `cancellation-outcome` | Cancellation API |

Each acknowledged event is flushed and synchronized to disk.

## Promotion criteria

Promote beyond the bounded pilot only when:

- No duplicate side effect occurs under replay or concurrent dispatch.
- Crash recovery passes at every persisted state boundary.
- Scope and stale-approval failures remain fail-closed.
- Cancellation terminates the worker process tree.
- Adapter parse failures have deterministic terminal states.
- The candidate adapter passes its conformance fixtures.
- Merge passes stale-approval and crash-injection gates.

Validation command:

```text
node scripts/validate-orchestrator-adversarial.mjs
```
