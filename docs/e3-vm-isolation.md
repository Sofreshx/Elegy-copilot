# Executive3 VM Isolation Strategy (Draft)

## Objective
Run multiple Executive3 sessions in isolated environments with full automation rights while keeping session/task visibility unified in the VS Code extension.

## Proposed architecture

## 1) Control plane (host)
- VS Code extension + canonical E3 DB remain on host.
- Orchestrator creates a session record first, then allocates an execution runtime.

## 2) Isolated runtime plane (VM or microVM)
- One VM per session (or per task-group for high concurrency).
- Runtime has:
  - checked-out repo snapshot,
  - full tool rights,
  - deterministic bootstrap script,
  - scoped secrets injection.

## 3) Sync bridge
- Runtime does **not** own the canonical DB.
- Runtime emits execution events (`task start`, `task done`, `test result`, `replan`) to host via:
  - local relay (preferred), or
  - signed JSON event files pulled by host agent.
- Host applies DB writes with `--db <canonical>`.

This avoids SQLite sharing over network filesystems while preserving one source of truth for extension views.

## Runtime options
- **WSL distro per session**: lowest friction on Windows.
- **Firecracker/Kata**: stronger isolation, more setup overhead.
- **Ephemeral cloud VM**: highest isolation, slower startup.

## Minimum deterministic contract
Each isolated session must provide:
- `session_id`
- `workspace_ref` (commit/revision)
- `event_sequence` (strictly increasing)
- `signed event payload` (or trusted local channel)

Host applies events idempotently using `(session_id, event_sequence)`.

## Extension visualization requirements
To keep UI accurate:
- Canonical DB remains host-local.
- Runtime status (booting/running/stopped/error) is stored as session metadata.
- Workflow tree surfaces:
  - active sessions,
  - resumable sessions,
  - runtime status,
  - latest event timestamp.

## Rollout plan
1. Add runtime metadata fields and event ingest command.
2. Implement WSL-based isolated runner MVP.
3. Add retries/idempotency for event apply.
4. Add runtime controls in extension (`start`, `stop`, `attach logs`).
5. Optional: migrate heavy parallel workloads to microVM backend.
