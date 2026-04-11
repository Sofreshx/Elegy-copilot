---
created: 2026-04-07
updated: 2026-04-10
category: research
status: stale
doc_kind: node
id: copilot-ui-mvp-scope-lock
summary: Historical MVP boundary note retained for context; current copilot-ui runtime authority lives in the canonical guide.
tags: [copilot-ui, mvp, task-board, workflows, desktop]
related: [copilot-ui-guide, copilot-ui-information-architecture-freeze, copilot-sdk-integration-adr, domain-authorities-freeze]
---

# copilot-ui MVP Scope Lock

This is a historical scope note. For the current MVP, runtime surface, and overlay behavior, use
[docs/system/copilot-ui-guide.md](../system/copilot-ui-guide.md).

## Purpose

Capture the clarified MVP boundary and near-term sequencing notes behind the canonical docs updates.

## Context

`copilot-ui` remains the canonical local desktop control plane. The IA stays frozen at four top-level
hubs: `Home / Runtime`, `Catalog`, `Planning`, and `Stats`.

## Details

### Locked MVP inclusions

- visible task board
- auto-triggered local workflow layer
- app-level parallel sessions
- in-session sub-agent/sub-actor decomposition
- same-repo worktree isolation
- local-only orchestration
- stable/prerelease app pairing with stable/prerelease SDK + CLI lanes
- app-managed Copilot CLI ensure/install/update behavior

### Scope distinctions

- **App-level parallel sessions** are separate live runtime sessions.
- **In-session sub-agents/sub-actors** are decomposition inside one session.
- **Same-repo worktree isolation** is filesystem/runtime isolation for parallel work on one repo.
- **Task board state** is a projection/control surface over `~/.copilot/repo-state/<repoId>/tasks/`,
  with only bounded ephemeral UI state outside canonical task storage.
- **Session artifacts** remain persisted projections/fallbacks; live runtime remains the authority.

### Validation-dependent items

The remaining validation items are intentionally still open:

- packaged n8n delivery shape for the local workflow layer
- exact Copilot CLI acquisition path
- Windows worktree cleanup semantics

Packaged n8n is the favored MVP direction, but this note does not promote it to a fully locked
implementation detail before validation closes.

### Sequencing note

1. Keep task-board durability anchored in repo-state tasks before adding richer UI-only behavior.
2. Keep workflow orchestration local-only while validating packaged workflow-runner shape.
3. Preserve the frozen 4-hub IA; do not add a fifth top-level runtime destination for task board,
   sessions, workflows, or sandboxes.

## References

- [copilot-ui Guide](../system/copilot-ui-guide.md)
- [copilot-ui Information Architecture Freeze](../system/copilot-ui-information-architecture-freeze.md)
- [Copilot SDK Integration ADR](../system/copilot-sdk-integration-adr.md)
- [Domain Authorities Freeze](../system/domain-authorities-freeze.md)
