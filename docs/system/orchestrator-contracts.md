---
created: 2026-06-19
updated: 2026-06-19
category: system
status: current
doc_kind: node
id: orchestrator-contracts
summary: Versioned wire contracts and semantic validation rules for the Harness Execution Orchestrator.
tags: [orchestrator, contracts, schemas, approvals]
related: [orchestrator-architecture-adr, structured-output-contracts]
---

# Harness Execution Orchestrator Contracts

## Authority

| Surface | Authority |
|---|---|
| JSON wire shape | `contracts/orchestrator/orchestrator-contracts.schema.json` |
| Architecture and trust boundaries | `docs/system/orchestrator-architecture-adr.md` (Rust implementation removed) |

Unknown additive fields are accepted. Unknown `schemaVersion` values fail closed.

## Contract set

| Contract | Version |
|---|---|
| Dispatch request | `orchestrator-dispatch/v1` |
| Worker result | `orchestrator-worker-result/v1` |
| Adapter capabilities | `orchestrator-adapter-capabilities/v1` |
| Execution event | `orchestrator-execution-event/v1` |
| Evidence claim | `orchestrator-evidence-claim/v1` |
| Approval token | `orchestrator-approval/v1` |
| Idempotency record | `orchestrator-idempotency/v1` |
| API error | `orchestrator-api-error/v1` |

Required execution identity:

```text
repoId + goalId + roadmapId + workPointId + runId
```

## Semantic gates

- Worker output above 1 MiB is rejected as oversized.
- Worker-reported claims never satisfy an authoritative verification gate.
- Approval validation rejects expired, consumed, or repository-state-mismatched tokens.
- Approval repository state binds `baseHeadSha`, `resultTreeSha`, `diffHash`, and `targetHeadSha`.
- V1 adapters are `opencode-acp`, `codex-exec`, and `native`.
- Claude Code is excluded from v1. Its adapter requires a future successful protocol spike.

## Fixtures

`contracts/orchestrator/fixtures/` covers valid dispatch, malformed dispatch, oversized output, stale approval, and repository-state mismatch.
