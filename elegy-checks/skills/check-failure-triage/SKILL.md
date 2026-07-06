---
name: check-failure-triage
description: "Inspect elegy-checks run logs and summarize local check failures without querying remote CI."
tags: [checks, logs, failure, triage]
---

# Check Failure Triage

Use SQLite-backed run evidence through the CLI.

## Workflow

1. Run `elegy-checks state --repo <root> --json`.
2. Identify the latest failed `runId`.
3. Run `elegy-checks logs --repo <root> --run-id <runId> --json`.
4. Inspect the failing check command, exit code, stdout, stderr, timeout, and truncation markers.
5. Summarize the smallest likely fix and the exact rerun command.

## Rules

- Do not fetch remote GitHub Actions logs in v1.
- Treat truncated logs as partial evidence.
- Keep failure summaries tied to command output, not guesses.
