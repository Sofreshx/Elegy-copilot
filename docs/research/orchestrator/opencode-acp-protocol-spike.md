---
created: 2026-06-18
updated: 2026-06-30
category: research
status: current
doc_kind: node
id: opencode-acp-protocol-spike
summary: ORCH-002 evidence and adapter decision for OpenCode ACP v1 over stdio.
tags: [acp, opencode, orchestrator, protocol-spike]
related: [orchestrator-architecture-adr]
---

# OpenCode ACP protocol spike

## Decision

Use `opencode acp` as the OpenCode worker adapter with capability negotiation and process
supervision.

Status: **conditional GO**.

| Contract | Result | Adapter rule |
|---|---|---|
| Transport | Pass | Spawn `opencode acp --cwd <worktree>` and exchange newline-delimited JSON-RPC 2.0 over stdio. |
| Dispatch | Pass | Use ACP `initialize` → `session/new` → `session/prompt`. Do not invent a worker-envelope CLI flag. |
| Events | Pass | Consume `session/update`; observed command, thought, tool-call, message, and usage updates. |
| Continuation | Pass | Repeated `session/prompt` preserved same-process context. |
| Restart resume | Pass | A cold replacement process restored context with `session/resume`. |
| Cancellation | Partial | `session/cancel` stopped a 60-second command in about 4 seconds and left Git clean, but OpenCode returned `end_turn`, not ACP `cancelled`. |
| Permissions | Inconclusive | No `session/request_permission` request occurred with the tested local configuration. The adapter must still implement it and select only policy-approved option IDs. |
| Malformed client input | Pass | Invalid prompt/session types returned JSON-RPC `-32602`; the same process accepted `session/new` afterward. |
| Malformed agent output | Not induced | Treat invalid JSON, unknown response IDs, and schema-invalid results as adapter failure. |

## Tested surface

- Date: 2026-06-18
- Platform: Windows
- OpenCode: `1.17.8`
- ACP protocol: `1`
- Fixture: removed with the Rust backend (2026-06-22)

OpenCode advertised:

```text
loadSession
MCP HTTP and SSE
prompt embedded context and image
session close, fork, list, and resume
```

The test client advertised no filesystem or terminal client capabilities. OpenCode executed its
own tools and emitted tool-call updates.

## Observed message flow

```text
client -> initialize(protocolVersion=1, clientCapabilities={})
agent  -> capabilities + authMethods + agentInfo
client -> session/new(cwd, mcpServers=[])
agent  -> sessionId
client -> session/prompt(sessionId, text blocks)
agent  -> session/update*
agent  -> session/prompt result(stopReason)
client -> session/cancel(sessionId)      # cancellation case
client -> session/resume(sessionId, cwd) # cold-process resume case
```

Fixture task evidence:

- `result.txt` contained exactly `ACP_OK\n`.
- The only repository change was `?? result.txt`.
- A second turn named the prior file.
- A replacement ACP process recalled `ORCH_RESUME_7421` after `session/resume`.
- Invalid input returned structured field errors and did not crash the process.
- Cancellation returned before the 60-second command deadline and left the fixture repository
  clean.

## Required adapter guards

1. Negotiate protocol version and required capabilities before dispatch.
2. Keep the ACP process cold and resumable. Persist the opaque session ID in the execution
   journal.
3. Treat the process tree as authoritative for cancellation completion. Record
   `protocol_stop_reason_mismatch` when cancellation returns a stop reason other than
   `cancelled`.
4. Apply a cancellation deadline, then terminate the entire child process tree.
5. Validate every JSON-RPC message. Reject malformed JSON, unknown response IDs, invalid
   schemas, and oversized output.
6. Do not trust worker completion, changed-file claims, or validation claims. Derive them from
   Git and orchestrator-run checks.
7. Implement `session/request_permission` even when a tested configuration emits none. Select
   only an offered option permitted by orchestrator policy.
8. Continue accepting updates until the prompt response boundary; record any later update as a
   protocol-ordering violation.

Fallback: if initialization, resume, cancellation supervision, or message validation fails,
mark the OpenCode adapter unavailable for that run. Do not fall back to undocumented CLI flags.

## Sources

- [OpenCode ACP support](https://opencode.ai/docs/acp/)
- [OpenCode CLI `acp`](https://opencode.ai/docs/cli/#acp)
- [ACP initialization](https://agentclientprotocol.com/protocol/v1/initialization)
- [ACP session setup and resume](https://agentclientprotocol.com/protocol/v1/session-setup)
- [ACP prompt turns and cancellation](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- [ACP permission requests](https://agentclientprotocol.com/protocol/v1/tool-calls#requesting-permission)
