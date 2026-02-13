# Executive3 DB Reliability Guide

## Goals
- Deterministic DB targeting across multi-root workspaces.
- Atomic persistence for session/task initialization.
- Fast diagnostics when integrity drift appears.
- Lightweight concurrency handling (safe under parallel agent calls).

## What changed
- **Canonical DB path propagation**: extension now writes `.e3-local/db-path.txt` in each workspace folder, pointing to a single canonical DB.
- **CLI conflict handling update**: discovery-file redirects are allowed when sibling workspace roots intentionally point to a canonical DB.
- **Atomic bundle command**: `create-session-bundle` creates plan/session/tasks/todo/task-plans in one SQLite transaction.
- **Write hardening**:
  - `PRAGMA busy_timeout = 5000`
  - deterministic retry loop on `SQLITE_BUSY` / lock contention.
- **Payload normalization**:
  - `depends_on` and `skills` accept either arrays or JSON string arrays.
  - task grouping defaults to `ungrouped` if omitted.
- **Explicit FK prechecks**: clearer failures for missing `plan_id`, `session_id`, `todo_id`, `task_id`, `parent_plan_id`.

## Operational checks
Run after suspicious behavior:

```bash
node vscode-skill-installer/scripts/e3-cli.js ensure-db
node vscode-skill-installer/scripts/e3-cli.js db-health --db "<captured-path>"
node vscode-skill-installer/scripts/e3-cli.js export-all --db "<captured-path>"
```

`db-health` reports:
- `quick_check`
- `foreign_key_violations`
- `orphan_tasks_by_session`
- `open_tasks_without_active_session`
- total row counts

## Recommended write path for orchestrators
1. `ensure-db` once.
2. Capture `path`.
3. Use `--db <captured-path>` on every call.
4. Prefer `create-session-bundle` for initial graph creation.
5. Use point commands (`create-task`, `create-task-plan`, etc.) for incremental updates.

## Parallel session safety
- SQLite WAL + busy timeout supports concurrent readers and short write bursts.
- Retries absorb transient lock collisions.
- All consistency-sensitive bootstrap writes can run in one transaction (`create-session-bundle`).

## Failure triage
1. Check DB path from stderr (`[E3 CLI] DB (...)` line).
2. Compare with extension diagnostics (`Executive3: Diagnostics`).
3. Run `db-health`.
4. If path mismatch: fix discovery file, rerun `ensure-db`, and keep using explicit `--db`.
