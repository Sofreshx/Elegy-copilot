---
created: 2026-06-18
updated: 2026-06-18
category: research
status: current
doc_kind: node
id: codex-exec-protocol-spike
summary: ORCH-003 evidence and adapter decision for Codex exec JSONL, structured output, resume, and cancellation.
tags: [codex, exec, orchestrator, protocol-spike]
related: [orchestrator-architecture-adr]
---

# Codex exec protocol spike

## Decision

Use `codex exec --json` as a supervised worker adapter for new turns.

Status: **conditional GO**.

Do not claim output-schema continuity across resumed turns. Codex CLI `0.119.0-alpha.28`
supports `--output-schema` on `exec` but rejects it on `exec resume`.

| Contract | Result | Adapter rule |
|---|---|---|
| Machine events | Pass | Parse stdout as JSONL. Treat non-JSON stdout or unknown required event shape as adapter failure. |
| Dispatch | Pass | Use explicit `--sandbox`, `--model`, `--json`, `--output-schema`, and `-C`. |
| Structured result | Pass | Initial turn produced schema-conforming JSON and wrote the requested fixture file. |
| Session identity | Pass | Persist `thread_id` from `thread.started`. |
| Resume | Pass | `codex exec resume <thread_id>` restored logical context in a new process. |
| Resume schema | Unsupported | `exec resume --output-schema` exits `2` with an unknown-argument error. Validate resumed final output externally or start a new schema-bound turn. |
| Cancellation | Pass with supervision | No semantic cancellation command exists. Terminate the full child process tree and treat non-zero exit as cancelled when initiated by the orchestrator. |
| Malformed schema | Pass | Invalid schema produced error/turn-failed events and non-zero exit; a later invocation succeeded. |

## Tested surface

- Date: 2026-06-18
- Platform: Windows
- Codex CLI: `0.119.0-alpha.28`
- Model: `gpt-5.4`
- Fixture: removed with the Rust backend (2026-06-22)

The WindowsApps Codex alias returned access denied when launched as a child process. The fixture
used `%USERPROFILE%\.codex\.sandbox-bin\codex.exe`. Production resolution must use the
repository CLI resolver and execute a preflight probe.

The default user config selected `gpt-5.5`, which this CLI rejected as requiring a newer Codex
version. The fixture pinned `gpt-5.4`. The adapter must negotiate or preflight the CLI/model pair
before dispatch.

## Observed event flow

```text
thread.started(thread_id)
item.completed(error)          # non-fatal local config diagnostic in tested environment
turn.started
item.started / item.completed  # command_execution, file_change, agent_message
turn.completed
```

Fixture evidence:

- `result.txt` contained exactly `CODEX_OK\n`.
- `--output-last-message` contained the schema-valid object:
  `{"file":"result.txt","content":"CODEX_OK"}`.
- A replacement process resumed the thread and recalled `ORCH_CODEX_RESUME_9137`.
- `exec resume --output-schema` was rejected before execution.
- Process-tree termination stopped a requested 60-second command in under 30 seconds and left
  Git clean.
- Invalid output schema failed deterministically; a later run returned `RECOVERED`.

## Required adapter guards

1. Resolve and preflight the executable, CLI version, selected model, authentication, and
   repository before dispatch.
2. Pass an explicit sandbox. Default to `read-only`; use `workspace-write` only for mutation
   work points.
3. Persist the `thread_id` from `thread.started`. Do not infer identity from local filenames.
4. Validate every JSONL event and bound stdout/stderr retention.
5. Enforce structured output only where the invoked command supports `--output-schema`.
6. For resumed turns, validate final output externally or start a new schema-bound thread.
7. On cancellation or timeout, terminate the entire process tree and record orchestrator intent
   separately from process exit status.
8. Treat worker file-change and validation events as claims. Derive actual Git state and run
   authoritative checks independently.
9. Classify local configuration diagnostics separately from terminal `error` and `turn.failed`
   events.

Fallback: mark the adapter unavailable when executable, model, auth, sandbox, JSONL, or schema
preflight fails. Do not silently downgrade sandbox or structured-output requirements.

## Sources

- [Codex non-interactive mode](https://developers.openai.com/codex/noninteractive)
- [Codex CLI reference](https://developers.openai.com/codex/cli/reference)
- [Codex sandbox and approvals](https://developers.openai.com/codex/security)
