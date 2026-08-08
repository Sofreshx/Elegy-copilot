---
created: 2026-08-08
updated: 2026-08-08
category: system
status: current
doc_kind: node
id: repo-operations-safety-adr
summary: Authority boundary for Repo Operations v4 fetch, cleanup, and merge-repair actions.
tags: [adr, repo-operations, safety, git]
related: [copilot-ui-guide]
---

# Repo Operations Safety ADR

## Context

Repo Operations aggregates local and remote state across many repositories and
offers maintenance actions whose safety can change after an overview is read.
Fetch, fast-forward updates, cleanup, and merge repair therefore need distinct
authority boundaries, fresh-state checks, and explicit confirmation instead
of treating a cached inventory as permission to mutate Git state.

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
