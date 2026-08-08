---
created: 2026-08-08
category: system
status: current
doc_kind: decision
id: repo-operations-safety-adr
summary: Authority boundary for Repo Operations v4 fetch, cleanup, and merge-repair actions.
related: [copilot-ui-guide, repo-operations-command-center]
---

# Repo Operations Safety ADR

## Decision

Repo Operations v4 divides maintenance into independent safety lanes:

- **Fetch** explicitly fetches and prunes remote-tracking refs only; it never changes a checkout.
- **Sync** remains fresh-state-checked fast-forward-only current-branch update.
- **Strict cleanup** removes only inactive entities provably merged into the default branch.
- **Analyzed cleanup** requires deterministic content-equivalence evidence, explicit selected-batch confirmation, and compare-and-delete SHA checks.
- **Merge repair** runs in an isolated managed worktree; push and final PR merge remain separate fresh-SHA approvals.

## Consequences

- GitHub is required for v1 remote cleanup because PR and protection evidence must be available.
- Dirty, active, protected, stale, or ambiguous entities fail closed and retain a readable evidence report.
- No Repo Operations action runs from tab navigation or a background schedule.
