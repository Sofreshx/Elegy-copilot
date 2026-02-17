# Agent Architecture: Simplicity Notes

This note captures the practical takeaways from a recent architecture review that emphasized explainable simplicity over clever complexity.

## Conclusions
- Prefer serial-by-default execution to avoid async chaos. Parallelism is optional and explicit.
- Session history is best captured in append-only JSONL for auditability.
- Long-term notes should stay in plain markdown when needed; avoid complex merges.
- Hybrid search (SQLite + FTS) is practical and debuggable.
- Browser automation should favor semantic snapshots over pixel-based screenshots for deterministic, token-efficient flows.

## How We Apply This
- Hooks write JSONL audit logs under `.instructions-output/hooks/`.
- Orchestrator stays serial by default and only parallelizes independent tasks.
- Agent-browser uses snapshot-first workflows for UI exploration and E2E.
